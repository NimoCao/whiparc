package runner

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

type FileItem struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type Node struct {
	ID   string      `json:"id"`
	Data interface{} `json:"data"`
}

type Canvas struct {
	Nodes []Node      `json:"nodes"`
	Edges interface{} `json:"edges"`
}

// RepositoryConfig holds the source repository details pulled from a Code Repository
// ("Source") node on the canvas, if one is present.
type RepositoryConfig struct {
	Present bool
	URL     string
	Branch  string
}

// extractRepositoryConfig scans the canvas JSON for a Code Repository node and returns
// its repo URL / branch parameters. Present is false if no such node exists on the canvas.
func extractRepositoryConfig(canvasJSON string) RepositoryConfig {
	var canvas struct {
		Nodes []struct {
			ID   string      `json:"id"`
			Data interface{} `json:"data"`
		} `json:"nodes"`
	}

	cfg := RepositoryConfig{}
	if err := json.Unmarshal([]byte(canvasJSON), &canvas); err != nil {
		return cfg
	}

	for _, node := range canvas.Nodes {
		dataMap, ok := node.Data.(map[string]interface{})
		if !ok {
			continue
		}
		tech, _ := dataMap["tech"].(string)
		if tech != "Source" {
			continue
		}
		cfg.Present = true
		if v, ok := dataMap["repoUrl"].(string); ok {
			cfg.URL = strings.TrimSpace(v)
		}
		if v, ok := dataMap["branch"].(string); ok {
			cfg.Branch = strings.TrimSpace(v)
		}
	}

	return cfg
}

// isSandbox parses the canvas JSON and determines if the current deployment targets the sandbox environment.
// IsSandbox is the exported entry point isSandbox's logic, used by main.go
// (outside this package) to decide whether it's safe to fall back to the
// shared sandbox SSH keypair for a deploy — see extractSecretsAndEnvironment
// and readSandboxPublicKey in main.go. A real AWS/GCP/Azure deploy must never
// silently reuse that shared key; only a LocalStack sandbox run may.
func IsSandbox(canvasJSON string) bool {
	return isSandbox(canvasJSON)
}

func isSandbox(canvasJSON string) bool {
	var canvas struct {
		Nodes []struct {
			ID   string                 `json:"id"`
			Data map[string]interface{} `json:"data"`
		} `json:"nodes"`
	}
	if err := json.Unmarshal([]byte(canvasJSON), &canvas); err != nil {
		return false
	}

	hasCloudTarget := false
	for _, node := range canvas.Nodes {
		if strings.HasPrefix(node.ID, "aws_target") {
			hasCloudTarget = true
			// The frontend's AWS Target inspector only writes an explicit
			// "environment" value into the saved node data once the user
			// actually touches the dropdown — a freshly dropped node just
			// *displays* "LocalStack (Sandbox)" as its default without
			// persisting it (see apps/web/app/workspace/page.tsx's
			// `environmentVal = data?.environment || 'localstack'`). So an
			// absent/empty environment field means the same thing the UI
			// shows: LocalStack. Only an explicit non-"localstack" value
			// (e.g. "aws") means a real live deploy.
			env := ""
			if params, ok := node.Data["parameters"].(map[string]interface{}); ok {
				if e, ok := params["environment"].(string); ok {
					env = e
				}
			}
			if env == "" {
				if e, ok := node.Data["environment"].(string); ok {
					env = e
				}
			}
			if env == "" || env == "localstack" {
				return true
			}
		} else if strings.HasPrefix(node.ID, "gcp_target") {
			hasCloudTarget = true
		}
	}
	// If there's no cloud target node (only Ansible nodes), it's a sandbox run.
	return !hasCloudTarget
}

// registerLocalStackAMI registers a dummy AMI in LocalStack and returns the assigned AMI ID.
// LocalStack 3.x does not pre-seed any AMIs, so Terraform fails with "couldn't find resource"
// unless we register one before running terraform apply.
func registerLocalStackAMI(localstackHost string) (string, error) {
	endpoint := fmt.Sprintf("http://%s:4566/", localstackHost)
	body := "Action=RegisterImage&Name=whiparc-ami&RootDeviceName=%2Fdev%2Fsda1&Version=2016-11-15"
	cmd := exec.Command("curl", "-s", "-X", "POST", endpoint,
		"-H", "Content-Type: application/x-www-form-urlencoded",
		"-d", body)
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("curl failed: %w", err)
	}
	re := regexp.MustCompile(`<imageId>(ami-[a-f0-9]+)</imageId>`)
	m := re.FindSubmatch(out)
	if len(m) < 2 {
		return "", fmt.Errorf("could not parse AMI ID from LocalStack response: %s", string(out))
	}
	return string(m[1]), nil
}

// AgentContext carries the resolved local sandbox agent for a project's
// `local_agent` deployment target (Phase 1 opt-in beta — see
// obsidian_memory/08.4 and 03.6). It is resolved by the caller (main.go's
// handleDeploy/handleDestroy, via a DB lookup) and passed in, keeping this
// package free of database/sql — it never talks to the DB itself.
type AgentContext struct {
	AgentID       string
	ProjectID     string
	GatewayURL    string
	PrivateKeyPEM string
}

// localAgentHostsINI is the Ansible inventory for a local_agent run. The
// host/port values here are never dialed directly over TCP/IP — each host's
// own ansible_ssh_common_args carries a ProxyCommand naming that host's
// --service, which is what actually routes the connection through the
// Gateway tunnel to a specific local SSH container.
//
// Per-host (not global) common-args is required, not a style choice: a
// single global --ssh-common-args CLI flag can't express two different
// ProxyCommands for two different hosts, and Ansible's inventory-level vars
// take precedence over that CLI flag anyway (obsidian_memory/08.4's Phase 1
// hardening item #4 hit exactly this — a global override for one thing
// silently discarding another). This previously hardcoded a single
// "agent-tunnel" host wired to --service=ssh:2222 unconditionally, so a node
// needing the sandbox's second SSH container (ubuntu_ssh_2, ssh:2223) could
// never be reached via local_agent even though the Agent's own allowlist
// (Phase 2) already permits it.
//
// Mirrors the docker-sandbox path's own !hasTfNodes shape immediately below
// this function (both ubuntu_ssh_1 and ubuntu_ssh_2 exposed under one
// [webservers] group) so a pure-Ansible local_agent run reaches both sandbox
// SSH containers, not just the first. The hasTfNodes case still targets a
// single host, matching a real Terraform-provisioned instance's single
// public IP — there is only ever one such instance today.
func localAgentHostsINI(agentCtx *AgentContext, hasTfNodes bool) string {
	hostLine := func(name, service string) string {
		return fmt.Sprintf("%s ansible_host=%s ansible_port=2222 ansible_user=ubuntu ansible_ssh_common_args=%s\n",
			name, name, localAgentHostSSHCommonArgs(agentCtx, service))
	}

	var hosts string
	if hasTfNodes {
		hosts = hostLine("agent-tunnel", "ssh:2222")
	} else {
		hosts = hostLine("agent-tunnel-1", "ssh:2222") + hostLine("agent-tunnel-2", "ssh:2223")
	}

	return strings.ReplaceAll(fmt.Sprintf(`[webservers]
%s
[all__COLON__vars]
ansible_python_interpreter=/usr/bin/python3`, hosts), "__COLON__", ":")
}

// localAgentHostSSHCommonArgs builds one host's ansible_ssh_common_args
// inventory value: a ProxyCommand that bridges Ansible's SSH connection for
// that specific host through the Gateway tunnel to the named service,
// instead of a direct dial (see obsidian_memory/08.4's Phase 1 design).
// OpenSSH itself spawns this as a subprocess, feeding it stdin/stdout as the
// transport; the ansible-playbook subprocess model otherwise stays exactly as
// it is for the live/docker targets. Single-quote-wrapped to match this
// file's existing ansible_ssh_common_args='...' convention (see the
// [all:vars] block below) — required here since the value contains spaces
// and, via %q, embedded double quotes around the ProxyCommand itself.
func localAgentHostSSHCommonArgs(agentCtx *AgentContext, service string) string {
	proxyCommand := fmt.Sprintf("%s sandbox proxy --agent-id=%s --service=%s --gateway=%s --project=%s",
		cliHelperPath(), agentCtx.AgentID, service, agentCtx.GatewayURL, agentCtx.ProjectID)
	return fmt.Sprintf("'-o StrictHostKeyChecking=no -o ProxyCommand=%q'", proxyCommand)
}

// cliHelperPath resolves the `whiparc` CLI binary used as the SSH
// ProxyCommand target for local_agent runs (see the ansibleArgs branch in
// RunPipeline). The hosted Runner's host/container must have this binary
// available — it already does, via the existing CLI release pipeline.
func cliHelperPath() string {
	if p := os.Getenv("WHIPARC_CLI_PATH"); p != "" {
		return p
	}
	return "whiparc"
}

// SecretRedactor masks sensitive credentials values inside log lines
type SecretRedactor struct {
	secrets []string
}

func (sr *SecretRedactor) Scrub(line string) string {
	if sr == nil {
		return line
	}
	for _, s := range sr.secrets {
		s = strings.TrimSpace(s)
		if len(s) > 5 {
			line = strings.ReplaceAll(line, s, "***REDACTED***")
		}
	}
	return line
}

func mergeEnvironments(base []string, overrides []string) []string {
	envMap := make(map[string]string)
	for _, kv := range base {
		parts := strings.SplitN(kv, "=", 2)
		if len(parts) == 2 {
			envMap[parts[0]] = parts[1]
		}
	}
	for _, kv := range overrides {
		parts := strings.SplitN(kv, "=", 2)
		if len(parts) == 2 {
			envMap[parts[0]] = parts[1]
		}
	}
	var merged []string
	for k, v := range envMap {
		merged = append(merged, fmt.Sprintf("%s=%s", k, v))
	}
	return merged
}

// Spawns a command, scans output line-by-line, and streams it with timestamps to logChan
func spawnCommand(name string, args []string, dir string, env []string, redactor *SecretRedactor, logChan chan<- string) error {
	ts := time.Now().Format("2006-01-02 15:04:05.000")
	logChan <- fmt.Sprintf("[%s] [RUNNER] Executing: %s %s\n", ts, name, redactor.Scrub(strings.Join(args, " ")))

	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	if len(env) > 0 {
		cmd.Env = append(os.Environ(), env...)
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}

	if err := cmd.Start(); err != nil {
		return err
	}

	outputChan := make(chan string)
	scan := func(r io.Reader) {
		scanner := bufio.NewScanner(r)
		for scanner.Scan() {
			outputChan <- scanner.Text()
		}
		if err := scanner.Err(); err != nil {
			outputChan <- fmt.Sprintf("[ERROR] failed to scan command output: %v", err)
		}
	}

	go scan(stdout)
	go scan(stderr)

	go func() {
		_ = cmd.Wait()
		close(outputChan)
	}()

	for line := range outputChan {
		tsLine := time.Now().Format("2006-01-02 15:04:05.000")
		logChan <- fmt.Sprintf("[%s] %s\n", tsLine, redactor.Scrub(line))
	}

	state := cmd.ProcessState
	if state != nil && !state.Success() {
		return fmt.Errorf("command failed with exit code %d", state.ExitCode())
	}
	return nil
}

func RunPipeline(
	runID string,
	canvasJSON string,
	files []FileItem,
	action string,
	autoDestroy bool,
	extraEnv []string,
	secretsToMask []string,
	agentCtx *AgentContext,
	logChan chan<- string,
	onNodeStatus func(nodeId, status string),
	onStatusChange func(status string),
	onComplete func(status string, logs string),
) {
	isDocker := os.Getenv("IS_DOCKER") == "true"
	isSandboxRun := isSandbox(canvasJSON)
	isLocalAgentRun := agentCtx != nil && agentCtx.AgentID != ""
	runDir := "/app/data/workspace/current"
	if !isDocker {
		runDir = "./data/workspace/current"
	}
	accumulatedLogs := ""

	redactor := &SecretRedactor{secrets: secretsToMask}

	// Write GCP credentials JSON if present
	var gcpCredsFilePath string
	for i, kv := range extraEnv {
		if strings.HasPrefix(kv, "GOOGLE_CREDENTIALS_CONTENT=") {
			content := strings.TrimPrefix(kv, "GOOGLE_CREDENTIALS_CONTENT=")
			gcpCredsFilePath = filepath.Join(runDir, "gcp-creds-temp.json")
			_ = os.WriteFile(gcpCredsFilePath, []byte(content), 0600)
			extraEnv[i] = "GOOGLE_CREDENTIALS=" + content
			extraEnv = append(extraEnv, "GOOGLE_APPLICATION_CREDENTIALS=" + gcpCredsFilePath)
			break
		}
	}
	if gcpCredsFilePath != "" {
		defer os.Remove(gcpCredsFilePath)
	}

	// Write SSH PEM private key if present (only when NOT targeting the local sandbox)
	var sshKeyFilePath string
	if !isSandboxRun {
		for i, kv := range extraEnv {
			if strings.HasPrefix(kv, "ANSIBLE_SSH_KEY_CONTENT=") {
				content := strings.TrimPrefix(kv, "ANSIBLE_SSH_KEY_CONTENT=")
				sshKeyFilePath = filepath.Join(runDir, "ansible-ssh-key-temp.pem")
				_ = os.WriteFile(sshKeyFilePath, []byte(content), 0600)
				extraEnv[i] = "ANSIBLE_SSH_KEY_PATH=" + sshKeyFilePath
				break
			}
		}
	}
	if sshKeyFilePath != "" {
		defer os.Remove(sshKeyFilePath)
	}

	// Helper to emit logs with prepended timestamps
	emit := func(msg string) {
		lines := strings.Split(msg, "\n")
		formattedMsg := ""
		for i, line := range lines {
			if i == len(lines)-1 && line == "" {
				break
			}
			tsLine := fmt.Sprintf("[%s] %s\n", time.Now().Format("2006-01-02 15:04:05.000"), redactor.Scrub(line))
			formattedMsg += tsLine
		}
		accumulatedLogs += formattedMsg
		logChan <- formattedMsg
	}

	defer func() {
		close(logChan)
	}()

	emit(fmt.Sprintf("[RUNNER] Starting pipeline run %s (Action: %s, Auto-Cleanup: %t)", runID, action, autoDestroy))

	localstackHost := "localhost"
	if isDocker {
		localstackHost = "localstack"
	}

	var canvas struct {
		Nodes []struct {
			ID   string `json:"id"`
			Data struct {
				Tech string `json:"tech"`
			} `json:"data"`
		} `json:"nodes"`
	}
	hasTfNodes := false
	hasAnsibleNodes := false
	hasK8sNodes := false

	var tfNodeIDs, ansibleNodeIDs, k8sNodeIDs, sourceNodeIDs, targetNodeIDs, allNodeIDs []string

	if err := json.Unmarshal([]byte(canvasJSON), &canvas); err == nil {
		for _, node := range canvas.Nodes {
			allNodeIDs = append(allNodeIDs, node.ID)
			switch node.Data.Tech {
			case "Terraform":
				hasTfNodes = true
				tfNodeIDs = append(tfNodeIDs, node.ID)
			case "Ansible":
				hasAnsibleNodes = true
				ansibleNodeIDs = append(ansibleNodeIDs, node.ID)
			case "Kubernetes":
				hasK8sNodes = true
				k8sNodeIDs = append(k8sNodeIDs, node.ID)
			case "Source":
				sourceNodeIDs = append(sourceNodeIDs, node.ID)
			case "Target":
				targetNodeIDs = append(targetNodeIDs, node.ID)
			}
		}
	} else {
		emit(fmt.Sprintf("[WARNING] Canvas JSON parsing failed: %v. Running all phases.", err))
		hasTfNodes = true
		hasAnsibleNodes = true
		hasK8sNodes = true
	}

	emitNodeStatus := func(nodeId, status string) {
		if onNodeStatus != nil {
			onNodeStatus(nodeId, status)
		}
	}

	emitSliceStatus := func(ids []string, status string) {
		for _, id := range ids {
			emitNodeStatus(id, status)
		}
	}

	emit(fmt.Sprintf("[RUNNER_DEBUG] parsed hasTfNodes=%t, hasAnsibleNodes=%t, hasK8sNodes=%t", hasTfNodes, hasAnsibleNodes, hasK8sNodes))

	verboseMode := os.Getenv("VERBOSE") == "true"
	tfEnv := []string{
		"AWS_ACCESS_KEY_ID=test",
		"AWS_SECRET_ACCESS_KEY=test",
		"AWS_DEFAULT_REGION=us-east-1",
	}
	if verboseMode {
		tfEnv = append(tfEnv, "TF_LOG=INFO")
	}
	if len(extraEnv) > 0 {
		tfEnv = mergeEnvironments(tfEnv, extraEnv)
	}
	tfDir := filepath.Join(runDir, "terraform")

	// ==========================================
	// ACTION: DESTROY
	// ==========================================
	if action == "destroy" {
		emitSliceStatus(allNodeIDs, "pending")
		emitSliceStatus(targetNodeIDs, "completed")
		emitSliceStatus(sourceNodeIDs, "completed")
		emitSliceStatus(ansibleNodeIDs, "completed")
		emitSliceStatus(k8sNodeIDs, "completed")

		if hasTfNodes && fileExists(filepath.Join(tfDir, "main.tf")) {
			emit("\n=========================================")
			emit("[PHASE DESTROY] AWS Teardown (Terraform)")
			emit("=========================================\n")

			var tfDestroyWg sync.WaitGroup
			tfDestroyWg.Add(1)
			tfDestroyWrapped := make(chan string, 200)
			go func() {
				defer tfDestroyWg.Done()
				for msg := range tfDestroyWrapped {
					logChan <- msg
					for _, id := range tfNodeIDs {
						if strings.Contains(msg, id+": Destroying") || strings.Contains(msg, id+": Still destroying") {
							emitNodeStatus(id, "running")
						} else if strings.Contains(msg, id+": Destruction complete") {
							emitNodeStatus(id, "completed")
						}
					}
				}
			}()
			destroyErr := spawnCommand("terraform", []string{"destroy", "-auto-approve"}, tfDir, tfEnv, redactor, tfDestroyWrapped)
			close(tfDestroyWrapped)
			tfDestroyWg.Wait()

			if destroyErr != nil {
				emit(fmt.Sprintf("[ERROR] Terraform destroy failed: %v", destroyErr))
				emitSliceStatus(tfNodeIDs, "failed")
				onComplete("FAILED", accumulatedLogs)
				return
			}
			emitSliceStatus(tfNodeIDs, "completed")
		} else {
			emit("[RUNNER] No active Terraform configurations found. Skip teardown.")
			emitSliceStatus(tfNodeIDs, "completed")
		}

		emit("\n[RUNNER] Infrastructure tear-down completed successfully!")
		onComplete("SUCCESS", accumulatedLogs)
		return
	}

	// ==========================================
	// ACTION: PLAN (DRY RUN)
	// ==========================================
	// Deliberately Terraform-only and read-only, per product-memory 08.5 item
	// A9's "keep v1 simple" scoping: writes the compiled files, runs `terraform
	// init` + `plan` (no -auto-approve — plan never mutates state), and stops.
	// No Ansible/Kubernetes phases (a "dry run" of a config-management/K8s
	// apply isn't the same operation and isn't what this feature asks for),
	// no local_agent/SSH routing (never reached, since Ansible is skipped),
	// no auto-destroy (nothing was created to destroy), and no per-node
	// status animation (a node isn't "completed" just because a plan
	// mentioned it — that would misleadingly imply it's actually provisioned).
	if action == "plan" {
		emitSliceStatus(allNodeIDs, "pending")

		for _, file := range files {
			fullPath := filepath.Join(runDir, file.Path)
			dirPath := filepath.Dir(fullPath)
			if err := os.MkdirAll(dirPath, 0755); err != nil {
				emit(fmt.Sprintf("[ERROR] Failed to create dir %s: %v", dirPath, err))
				onComplete("FAILED", accumulatedLogs)
				return
			}
			content := file.Content
			if file.Path == "terraform/main.tf" {
				content = strings.ReplaceAll(content, "http://localhost:4566", fmt.Sprintf("http://%s:4566", localstackHost))
			}
			if err := os.WriteFile(fullPath, []byte(content), 0644); err != nil {
				emit(fmt.Sprintf("[ERROR] Failed to write file %s: %v", file.Path, err))
				onComplete("FAILED", accumulatedLogs)
				return
			}
			emit(fmt.Sprintf("[COMPILER] Created %s", file.Path))
		}

		if !hasTfNodes || !fileExists(filepath.Join(tfDir, "main.tf")) {
			emit("\n[RUNNER] No Terraform configuration on this canvas — nothing to plan.")
			onComplete("SUCCESS", accumulatedLogs)
			return
		}

		emit("\n=========================================")
		emit("[PHASE 01] Terraform Plan (Dry Run — No Changes Applied)")
		emit("=========================================\n")

		if isDocker && isSandboxRun {
			emit("[RUNNER] Ensuring LocalStack S3 state bucket exists...")
			_ = spawnCommand("curl", []string{"-X", "PUT", fmt.Sprintf("http://%s:4566/whiparc-state-bucket", localstackHost)}, runDir, nil, redactor, logChan)
			// Deliberately no AMI pre-registration here (unlike the deploy
			// path): a plan never calls the provider to validate a new
			// resource's own attribute values like an AMI ID, only init's
			// backend/provider setup — so the placeholder AMI in main.tf is
			// harmless for a plan and patching it would be dead work.
		}

		_ = os.Remove(filepath.Join(tfDir, ".terraform", "terraform.tfstate"))
		if err := spawnCommand("terraform", []string{"init", "-reconfigure", "-input=false", "-force-copy"}, tfDir, tfEnv, redactor, logChan); err != nil {
			emit(fmt.Sprintf("[ERROR] Terraform init failed: %v", err))
			onComplete("FAILED", accumulatedLogs)
			return
		}

		planErr := spawnCommand("terraform", []string{"plan", "-input=false"}, tfDir, tfEnv, redactor, logChan)
		if planErr != nil {
			emit(fmt.Sprintf("[ERROR] Terraform plan failed: %v", planErr))
			onComplete("FAILED", accumulatedLogs)
			return
		}

		emit("\n[RUNNER] Plan completed — no changes were made.")
		onComplete("SUCCESS", accumulatedLogs)
		return
	}

	// ==========================================
	// ACTION: DEPLOY (DEFAULT)
	// ==========================================
	emitSliceStatus(allNodeIDs, "pending")
	emitSliceStatus(targetNodeIDs, "completed")

	for _, file := range files {
		fullPath := filepath.Join(runDir, file.Path)
		dirPath := filepath.Dir(fullPath)

		if err := os.MkdirAll(dirPath, 0755); err != nil {
			emit(fmt.Sprintf("[ERROR] Failed to create dir %s: %v", dirPath, err))
			onComplete("FAILED", accumulatedLogs)
			return
		}

		content := file.Content

		// --- LOCAL SANDBOX OVERRIDES ---
		if file.Path == "terraform/main.tf" {
			content = strings.ReplaceAll(content, "http://localhost:4566", fmt.Sprintf("http://%s:4566", localstackHost))
		}

		if file.Path == "ansible/hosts.ini" && isLocalAgentRun {
			content = localAgentHostsINI(agentCtx, hasTfNodes)
		} else if file.Path == "ansible/hosts.ini" && isSandboxRun && isDocker {
			if !hasTfNodes {
				content = strings.ReplaceAll(`[webservers]
ubuntu_ssh_1 ansible_host=ubuntu_ssh_1 ansible_port=22 ansible_user=ubuntu
ubuntu_ssh_2 ansible_host=ubuntu_ssh_2 ansible_port=22 ansible_user=ubuntu

[all__COLON__vars]
ansible_python_interpreter=/usr/bin/python3`, "__COLON__", ":")
			} else {
				re := regexp.MustCompile(`(?:aws_instance\.[a-zA-Z0-9_-]+\.public_ip|google_compute_instance\.[a-zA-Z0-9_-]+\.public_ip|azurerm_public_ip\.pip\.ip_address|{{\s*(?:nodes\.)?[a-zA-Z0-9_-]+\.public_ip\s*}})`)
				content = re.ReplaceAllString(content, "ubuntu_ssh_1")
			}
		}

		// Inject custom SSH key path and username into hosts.ini if ANSIBLE_SSH_KEY_PATH is present.
		// Skipped entirely for a local_agent run: this block writes
		// ansible_ssh_private_key_file / ansible_ssh_common_args into
		// hosts.ini's [all:vars], and Ansible's inventory-level vars take
		// precedence over the --private-key/--ssh-common-args CLI flags
		// localAgentSSHCommonArgs already set — so leaving this block
		// unconditional silently discarded the ProxyCommand tunnel bridge
		// whenever a project had BOTH a paired agent and a separately
		// configured project SSH credential, falling back to a direct
		// (unreachable) connection to the "agent-tunnel" placeholder host.
		if file.Path == "ansible/hosts.ini" && !isLocalAgentRun {
			if !isSandboxRun {
				var customSshUser string
				for _, kv := range extraEnv {
					if strings.HasPrefix(kv, "ANSIBLE_SSH_USER=") {
						customSshUser = strings.TrimPrefix(kv, "ANSIBLE_SSH_USER=")
						break
					}
				}
				if customSshUser != "" {
					reUser := regexp.MustCompile(`ansible_user=[a-zA-Z0-9_-]+`)
					content = reUser.ReplaceAllString(content, "ansible_user="+customSshUser)
				}
			}

			if sshKeyFilePath != "" {
				// Ensure content ends with a newline before appending new variables
				if !strings.HasSuffix(content, "\n") {
					content += "\n"
				}
				// Find [all:vars] or append it
				if !strings.Contains(content, "[all:vars]") {
					content += "\n[all:vars]\n"
				}
				content += fmt.Sprintf("ansible_ssh_private_key_file=%s\n", sshKeyFilePath)
				content += "ansible_ssh_common_args='-o StrictHostKeyChecking=no'\n"
			}
		}

		if file.Path == "ansible/playbook.yml" {
			appDir := filepath.Join(runDir, "app")
			content = strings.ReplaceAll(content, "__APP_SRC_DIR__", appDir)
		}

		if err := os.WriteFile(fullPath, []byte(content), 0644); err != nil {
			emit(fmt.Sprintf("[ERROR] Failed to write file %s: %v", file.Path, err))
			onComplete("FAILED", accumulatedLogs)
			return
		}
		emit(fmt.Sprintf("[COMPILER] Created %s", file.Path))
	}

	repoConfig := extractRepositoryConfig(canvasJSON)
	if repoConfig.Present && repoConfig.URL != "" {
		emit("\n=========================================")
		emit("[PHASE 00] Fetching Application Source Code")
		emit("=========================================\n")

		emitSliceStatus(sourceNodeIDs, "running")

		branch := repoConfig.Branch
		if branch == "" {
			branch = "main"
		}
		appDir := filepath.Join(runDir, "app")
		_ = os.RemoveAll(appDir)

		cloneArgs := []string{"clone", "--branch", branch, "--depth", "1", repoConfig.URL, appDir}
		if err := spawnCommand("git", cloneArgs, runDir, nil, redactor, logChan); err != nil {
			emit(fmt.Sprintf("[ERROR] Failed to clone repository %s (branch %s): %v", repoConfig.URL, branch, err))
			emitSliceStatus(sourceNodeIDs, "failed")
			onComplete("FAILED", accumulatedLogs)
			return
		}
		emitSliceStatus(sourceNodeIDs, "completed")
	} else if repoConfig.Present {
		emit("\n[PHASE 00] Skipped (Code Repository node present but no repository URL configured)")
		emitSliceStatus(sourceNodeIDs, "completed")
	} else {
		emit("\n[PHASE 00] Skipped (No Code Repository node present on canvas)")
	}

	appDir := filepath.Join(runDir, "app")
	if !fileExists(appDir) {
		_ = os.MkdirAll(appDir, 0755)
		_ = os.WriteFile(filepath.Join(appDir, "placeholder.txt"), []byte("placeholder"), 0644)
	}

	// Phase 1: Terraform (Provisioning)
	if hasTfNodes && fileExists(filepath.Join(tfDir, "main.tf")) {
		emit("\n=========================================")
		emit("[PHASE 01] Cloud Infrastructure Provisioning")
		emit("=========================================\n")
		if isDocker {
			mainTfPath := filepath.Join(tfDir, "main.tf")
			isLocalStack := false
			if content, err := os.ReadFile(mainTfPath); err == nil {
				if strings.Contains(string(content), "whiparc-state-bucket") {
					isLocalStack = true
				}
			}
			if !isLocalStack && !strings.Contains(strings.Join(tfEnv, " "), "AWS_SECRET_ACCESS_KEY=") {
				isLocalStack = true
			}

			if isLocalStack {
				emit("[RUNNER] Ensuring LocalStack S3 state bucket exists...")
				_ = spawnCommand("curl", []string{"-X", "PUT", fmt.Sprintf("http://%s:4566/whiparc-state-bucket", localstackHost)}, runDir, nil, redactor, logChan)

				emit("[RUNNER] Pre-registering dummy AMI in LocalStack...")
				if amiID, err := registerLocalStackAMI(localstackHost); err != nil {
					emit(fmt.Sprintf("[RUNNER] Warning: AMI pre-registration failed: %v", err))
				} else {
					emit(fmt.Sprintf("[RUNNER] Registered LocalStack AMI: %s — patching main.tf", amiID))
					if content, err := os.ReadFile(mainTfPath); err == nil {
						re := regexp.MustCompile(`ami\s*=\s*"[^"]*"`)
						patched := re.ReplaceAllString(string(content), fmt.Sprintf(`ami = "%s"`, amiID))
						_ = os.WriteFile(mainTfPath, []byte(patched), 0644)
					}
				}
			}
		}

		// Clean up previous backend state pointer to avoid "Unsetting previously set backend s3" init errors when switching targets
		_ = os.Remove(filepath.Join(tfDir, ".terraform", "terraform.tfstate"))

		// -force-copy answers "yes" to Terraform's backend state-migration
		// prompt automatically. Without it, `-input=false` (required since
		// this runs unattended) makes init fail outright with "Can't ask
		// approval for state migration" whenever the backend config changes
		// between runs of the same workspace and existing state needs
		// migrating — e.g. LocalStack sandbox runs re-targeting the same
		// state bucket after prior runs. Safe to force here: this is
		// throwaway sandbox/live state Terraform manages itself, not a
		// destructive action on user data.
		if err := spawnCommand("terraform", []string{"init", "-reconfigure", "-input=false", "-force-copy"}, tfDir, tfEnv, redactor, logChan); err != nil {
			emit(fmt.Sprintf("[ERROR] Terraform init failed: %v", err))
			emitSliceStatus(tfNodeIDs, "failed")
			onComplete("FAILED", accumulatedLogs)
			return
		}

		var tfWg sync.WaitGroup
		tfWg.Add(1)
		tfWrapped := make(chan string, 200)
		go func() {
			defer tfWg.Done()
			for msg := range tfWrapped {
				logChan <- msg
				for _, id := range tfNodeIDs {
					if strings.Contains(msg, id+": Creating") || strings.Contains(msg, id+": Modifying") || strings.Contains(msg, id+": Still creating") {
						emitNodeStatus(id, "running")
					} else if strings.Contains(msg, id+": Creation complete") || strings.Contains(msg, id+": Modifications complete") {
						emitNodeStatus(id, "completed")
					}
				}
			}
		}()
		applyErr := spawnCommand("terraform", []string{"apply", "-auto-approve"}, tfDir, tfEnv, redactor, tfWrapped)
		close(tfWrapped)
		tfWg.Wait()
		if applyErr != nil {
			emit(fmt.Sprintf("[ERROR] Terraform apply failed: %v", applyErr))
			emitSliceStatus(tfNodeIDs, "failed")
			onComplete("FAILED", accumulatedLogs)
			return
		}

		// Resolve public IP in hosts.ini from Terraform outputs
		hostsPath := filepath.Join(runDir, "ansible", "hosts.ini")
		if fileExists(hostsPath) {
			hostsBytes, err := os.ReadFile(hostsPath)
			if err == nil {
				hostsContent := string(hostsBytes)
				
				// Resolve AWS Public IP
				cmdAws := exec.Command("terraform", "output", "-raw", "web_server_public_ip")
				cmdAws.Dir = tfDir
				cmdAws.Env = append(os.Environ(), tfEnv...)
				if out, err := cmdAws.Output(); err == nil {
					publicIP := strings.TrimSpace(string(out))
					if publicIP != "" && !strings.Contains(publicIP, "No outputs") {
						re := regexp.MustCompile(`aws_instance\.[a-zA-Z0-9_-]+\.public_ip`)
						hostsContent = re.ReplaceAllString(hostsContent, publicIP)
						_ = os.WriteFile(hostsPath, []byte(hostsContent), 0644)
						emit(fmt.Sprintf("[RUNNER] Resolved AWS public IP: %s", publicIP))
					}
				}

				// Resolve GCP Public IP
				cmdGcp := exec.Command("terraform", "output", "-raw", "gcp_instance_public_ip")
				cmdGcp.Dir = tfDir
				cmdGcp.Env = append(os.Environ(), tfEnv...)
				if out, err := cmdGcp.Output(); err == nil {
					publicIP := strings.TrimSpace(string(out))
					if publicIP != "" && !strings.Contains(publicIP, "No outputs") {
						re := regexp.MustCompile(`google_compute_instance\.[a-zA-Z0-9_-]+\.public_ip`)
						hostsContent = re.ReplaceAllString(hostsContent, publicIP)
						_ = os.WriteFile(hostsPath, []byte(hostsContent), 0644)
						emit(fmt.Sprintf("[RUNNER] Resolved GCP public IP: %s", publicIP))
					}
				}
			}
		}

		// Invoke dynamic parameter passing hydrator bridge
		if err := HydrateDynamicParameters(runDir, "terraform"); err != nil {
			emit(fmt.Sprintf("[WARNING] Hydration of dynamic parameters failed: %v", err))
		} else {
			emit("[RUNNER] Hydrated all dynamic variable parameter expressions successfully")
		}

		emitSliceStatus(tfNodeIDs, "completed")
	} else {
		emit("\n[PHASE 01] Skipped (No Terraform provisioning nodes present on canvas)")
		emitSliceStatus(tfNodeIDs, "completed")
	}

	// Phase 2: Ansible (Configuration)
	ansibleDir := filepath.Join(runDir, "ansible")
	emit(fmt.Sprintf("[RUNNER_DEBUG] ansibleDir=%s, playbook exists=%t", ansibleDir, fileExists(filepath.Join(ansibleDir, "playbook.yml"))))
	if hasAnsibleNodes && fileExists(filepath.Join(ansibleDir, "playbook.yml")) {
		emit("\n=========================================")
		emit("[PHASE 02] Server Configuration (Ansible)")
		emit("=========================================\n")

		var activeKeyPath string
		if isLocalAgentRun {
			// Per-installation key uploaded once during pairing (see
			// obsidian_memory/08.4) — decrypted by the caller and handed in via
			// agentCtx, never persisted server-side outside the vault.
			tmpKeyPath := fmt.Sprintf("/tmp/agent_key_%s", runID)
			_ = os.WriteFile(tmpKeyPath, []byte(agentCtx.PrivateKeyPEM), 0600)
			defer os.Remove(tmpKeyPath)
			activeKeyPath = tmpKeyPath
		} else if sshKeyFilePath != "" {
			activeKeyPath = sshKeyFilePath
		} else if isSandboxRun {
			// Sandbox fallback — only for a LocalStack sandbox run. A real
			// AWS/GCP/Azure deploy must never silently reuse this shared,
			// every-install key; see the matching gate on the Terraform-side
			// public key injection in apps/api/main.go's
			// extractSecretsAndEnvironment. Falling through with
			// activeKeyPath == "" here surfaces the "Private SSH key not
			// found" error below instead, which is the correct outcome for a
			// live deploy with no credential configured.
			keySourcePath := "/app/sandbox/id_rsa"
			if !fileExists(keySourcePath) {
				keySourcePath = "../../sandbox/id_rsa"
			}
			if fileExists(keySourcePath) {
				tmpKeyPath := fmt.Sprintf("/tmp/id_rsa_%s", runID)
				keyData, _ := os.ReadFile(keySourcePath)
				_ = os.WriteFile(tmpKeyPath, keyData, 0600)
				defer os.Remove(tmpKeyPath)
				activeKeyPath = tmpKeyPath
			}
		}

		if activeKeyPath == "" {
			if isSandboxRun {
				emit("[ERROR] Private SSH key not found. Ensure keys are configured.")
			} else {
				emit("[ERROR] This live deploy has no SSH credential configured. Add one under Project Credentials before deploying to a real cloud target — the shared sandbox key cannot be used for real infrastructure.")
			}
			emitSliceStatus(ansibleNodeIDs, "failed")
			onComplete("FAILED", accumulatedLogs)
			return
		}

		// For a local_agent run, this global default is deliberately left
		// without a ProxyCommand: every host in a local_agent hosts.ini is
		// generated by localAgentHostsINI above with its own per-host
		// ansible_ssh_common_args (a distinct ProxyCommand per host, needed
		// once a run can address more than one sandbox SSH container), and
		// Ansible's inventory-level vars take precedence over this CLI flag
		// regardless.
		sshCommonArgs := "-o StrictHostKeyChecking=no"
		ansibleArgs := []string{
			"-i", "hosts.ini",
			"playbook.yml",
			"--private-key=" + activeKeyPath,
			"--ssh-common-args=" + sshCommonArgs,
		}
		if verboseMode {
			ansibleArgs = append(ansibleArgs, "-vvv")
		}

		ansibleIdx := 0
		var ansibleWg sync.WaitGroup
		ansibleWg.Add(1)
		ansibleWrapped := make(chan string, 200)
		go func() {
			defer ansibleWg.Done()
			for msg := range ansibleWrapped {
				logChan <- msg
				if strings.Contains(msg, "TASK [") {
					if ansibleIdx > 0 && ansibleIdx-1 < len(ansibleNodeIDs) {
						emitNodeStatus(ansibleNodeIDs[ansibleIdx-1], "completed")
					}
					if ansibleIdx < len(ansibleNodeIDs) {
						emitNodeStatus(ansibleNodeIDs[ansibleIdx], "running")
					}
					ansibleIdx++
				}
			}
		}()
		ansibleErr := spawnCommand("ansible-playbook", ansibleArgs, ansibleDir, mergeEnvironments(nil, extraEnv), redactor, ansibleWrapped)
		close(ansibleWrapped)
		ansibleWg.Wait()
		if ansibleErr != nil {
			emit(fmt.Sprintf("[ERROR] Ansible playbook execution failed: %v", ansibleErr))
			emitSliceStatus(ansibleNodeIDs, "failed")
			onComplete("FAILED", accumulatedLogs)
			return
		}
		emitSliceStatus(ansibleNodeIDs, "completed")
	} else {
		emit("\n[PHASE 02] Skipped (No Ansible configuration nodes present on canvas)")
		emitSliceStatus(ansibleNodeIDs, "completed")
	}

	// Phase 3: Kubernetes (Container Deployment)
	k8sDir := filepath.Join(runDir, "k8s")
	if hasK8sNodes && fileExists(filepath.Join(k8sDir, "deployment.yaml")) {
		emit("\n=========================================")
		emit("[PHASE 03] Kubernetes Deployment (kubectl)")
		emit("=========================================\n")

		emitSliceStatus(k8sNodeIDs, "running")

		kubectlArgs := []string{"apply", "-f", "deployment.yaml"}
		if verboseMode {
			kubectlArgs = append(kubectlArgs, "--v=6")
		}

		if err := spawnCommand("kubectl", kubectlArgs, k8sDir, mergeEnvironments(nil, extraEnv), redactor, logChan); err != nil {
			emit(fmt.Sprintf("[ERROR] kubectl apply failed: %v", err))
			emitSliceStatus(k8sNodeIDs, "failed")
			onComplete("FAILED", accumulatedLogs)
			return
		}
		emitSliceStatus(k8sNodeIDs, "completed")
	} else {
		emit("\n[PHASE 03] Skipped (No Kubernetes deployment nodes present on canvas)")
		emitSliceStatus(k8sNodeIDs, "completed")
	}

	if autoDestroy && hasTfNodes && fileExists(filepath.Join(tfDir, "main.tf")) {
		if onStatusChange != nil {
			onStatusChange("CLEANUP")
		}
		emit("\n=========================================")
		emit("[PHASE CLEANUP] Ephemeral Auto-Destruction")
		emit("=========================================\n")
		_ = spawnCommand("terraform", []string{"destroy", "-auto-approve"}, tfDir, tfEnv, redactor, logChan)
	}

	emit("\n[RUNNER] Pipeline execution completed successfully!")
	onComplete("SUCCESS", accumulatedLogs)
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
