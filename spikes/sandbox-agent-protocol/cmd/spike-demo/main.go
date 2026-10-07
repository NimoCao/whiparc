// spike-demo is a runnable, narrated walkthrough of the Phase 0 protocol spike
// (see obsidian_memory/08.4): device-authorization pairing, an Agent dialing out
// to a Gateway, a yamux tunnel established over that WebSocket, and a Runner-side
// SSH exec streaming its output back through the tunnel from a throwaway fake
// SSH target. Run it with:
//
//	go run ./cmd/spike-demo
//
// This intentionally runs Gateway, Agent, and the "Runner" dial all in one
// process for a self-contained demo — the same protocol is exercised over real
// network sockets (127.0.0.1) either way. See e2e_test.go for the automated,
// asserted version of this same walkthrough.
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"

	"spikes/sandbox-agent-protocol/internal/agent"
	"spikes/sandbox-agent-protocol/internal/fakesshd"
	"spikes/sandbox-agent-protocol/internal/gateway"
	"spikes/sandbox-agent-protocol/internal/wsconn"
)

func step(format string, args ...any) {
	fmt.Printf("\n>> "+format+"\n", args...)
}

func must(err error, what string) {
	if err != nil {
		log.Fatalf("%s: %v", what, err)
	}
}

func main() {
	step("Generating a per-installation SSH keypair (never a committed key)")
	clientSigner, clientPub, err := fakesshd.GenerateKeyPair()
	must(err, "generate keypair")

	step("Starting a throwaway fake SSH target (stands in for ubuntu_ssh_1)")
	sshd, err := fakesshd.New(clientPub)
	must(err, "start fake sshd")
	defer sshd.Close()
	fmt.Printf("   fake sshd listening on %s\n", sshd.Addr())

	step("Starting the Agent Gateway")
	gw := gateway.New("https://www.whiparc.dev/pair")
	httpSrv := httptest.NewServer(gw.Mux())
	defer httpSrv.Close()
	wsURL := "ws" + strings.TrimPrefix(httpSrv.URL, "http")
	fmt.Printf("   gateway listening on %s\n", httpSrv.URL)

	step("Running device-authorization pairing (RFC 8628 style)")
	deviceCode, userCode := requestDeviceCode(httpSrv.URL)
	fmt.Printf("   agent prints: visit %s/pair?code=%s\n", httpSrv.URL, userCode)
	fmt.Printf("   (user opens that URL in their already-logged-in browser and approves)\n")
	approve(httpSrv.URL, userCode, "acct_demo", "proj_demo")
	token := pollToken(httpSrv.URL, deviceCode)
	fmt.Printf("   agent received scoped token: %s...\n", token[:8])

	step("Agent dialing out to the Gateway and opening the yamux tunnel")
	ag, err := agent.Connect(httpSrv.URL, token, "agent-demo", map[string]string{
		"ssh:2222": sshd.Addr(),
	})
	must(err, "agent connect")
	defer ag.Close()
	go func() {
		if err := ag.Serve(); err != nil {
			log.Printf("   (agent tunnel closed: %v)", err)
		}
	}()
	time.Sleep(50 * time.Millisecond)
	fmt.Println("   tunnel established, agent accepting streams")

	step("Simulating a Runner dial: open stream to agent-demo, service=ssh:2222")
	conn := runnerDial(wsURL, "agent-demo", "ssh:2222", "acct_demo", "proj_demo")
	defer conn.Close()

	step("SSH handshake over the tunnel, then exec with streamed output")
	sshConn, chans, reqs, err := ssh.NewClientConn(conn, "sandbox-agent-tunnel", &ssh.ClientConfig{
		User:            "root",
		Auth:            []ssh.AuthMethod{ssh.PublicKeys(clientSigner)},
		HostKeyCallback: ssh.FixedHostKey(clientPub),
		Timeout:         5 * time.Second,
	})
	must(err, "ssh handshake over tunnel")
	sshClient := ssh.NewClient(sshConn, chans, reqs)
	defer sshClient.Close()

	session, err := sshClient.NewSession()
	must(err, "new ssh session")
	defer session.Close()

	stdout, err := session.StdoutPipe()
	must(err, "stdout pipe")

	must(session.Start(`for i in 1 2 3 4; do echo "[deploy] step $i/4 complete"; sleep 0.3; done`), "start exec")

	scanner := bufio.NewScanner(stdout)
	start := time.Now()
	for scanner.Scan() {
		fmt.Printf("   [+%6s] %s\n", time.Since(start).Round(10*time.Millisecond), scanner.Text())
	}
	must(scanner.Err(), "scan stdout")
	must(session.Wait(), "session wait")

	step("Proving the allowlist: dialing a service the agent never registered")
	if _, resp, err := tryRunnerDial(wsURL, "agent-demo", "localstack:4566", "acct_demo", "proj_demo"); err != nil {
		fmt.Printf("   rejected as expected: HTTP %d\n", resp.StatusCode)
	} else {
		log.Fatal("   BUG: disallowed service dial should have been rejected")
	}

	fmt.Println("\nPhase 0 spike complete: pairing, tunnel, SSH-exec, and streamed logs all proven end to end.")
}

func requestDeviceCode(baseURL string) (deviceCode, userCode string) {
	resp, err := http.Post(baseURL+"/device/code", "application/json", nil)
	must(err, "device/code")
	defer resp.Body.Close()
	var out struct {
		DeviceCode string `json:"device_code"`
		UserCode   string `json:"user_code"`
	}
	must(json.NewDecoder(resp.Body).Decode(&out), "decode device/code")
	return out.DeviceCode, out.UserCode
}

func approve(baseURL, userCode, accountID, projectID string) {
	body, _ := json.Marshal(map[string]string{"user_code": userCode, "account_id": accountID, "project_id": projectID})
	resp, err := http.Post(baseURL+"/device/approve", "application/json", bytes.NewReader(body))
	must(err, "device/approve")
	resp.Body.Close()
}

func pollToken(baseURL, deviceCode string) string {
	body, _ := json.Marshal(map[string]string{"device_code": deviceCode})
	resp, err := http.Post(baseURL+"/device/token", "application/json", bytes.NewReader(body))
	must(err, "device/token")
	defer resp.Body.Close()
	var out struct {
		AgentToken string `json:"agent_token"`
	}
	must(json.NewDecoder(resp.Body).Decode(&out), "decode device/token")
	return out.AgentToken
}

func runnerDial(wsURL, agentID, service, accountID, projectID string) *wsconn.Conn {
	conn, _, err := tryRunnerDial(wsURL, agentID, service, accountID, projectID)
	must(err, "runner dial")
	return conn
}

func tryRunnerDial(wsURL, agentID, service, accountID, projectID string) (*wsconn.Conn, *http.Response, error) {
	u, _ := url.Parse(wsURL + "/runner/dial")
	q := u.Query()
	q.Set("agent_id", agentID)
	q.Set("service", service)
	q.Set("account_id", accountID)
	q.Set("project_id", projectID)
	u.RawQuery = q.Encode()

	ws, resp, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		return nil, resp, err
	}
	return wsconn.New(ws), resp, nil
}
