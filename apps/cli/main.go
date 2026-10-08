package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/gorilla/websocket"
	"github.com/spf13/cobra"
	"golang.org/x/term"
)

type Config struct {
	APIURL string `json:"api_url"`
	Token  string `json:"token"`
	// SandboxAgentBeta gates the `sandbox` command group (Phase 1 opt-in beta —
	// see obsidian_memory/08.4). Off by default; enable via
	// `whiparc config set sandbox-agent-beta true`.
	SandboxAgentBeta bool `json:"sandbox_agent_beta"`
	// GatewayURL is the Agent Gateway (apps/agent-gateway) the sandbox commands
	// talk to for pairing and tunneling. Defaults to http://localhost:9090.
	GatewayURL string `json:"gateway_url"`
}

type Project struct {
	ID          string `json:"id"`
	TeamID      string `json:"team_id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Visibility  string `json:"visibility"`
	CreatedBy   string `json:"created_by"`
}

type FileItem struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

var (
	apiURLFlag string
	tokenFlag  string

	// version is injected at build time via -ldflags "-X main.version=...";
	// left as "dev" for local `go build`/`go run`.
	version = "dev"

	// gatewayURLDefault is injected the same way, via
	// -ldflags "-X main.gatewayURLDefault=...", only for tagged release
	// builds (see .github/workflows/cli-release.yml) — left empty for local
	// builds and PR/dev artifacts, so getClientConfig falls back to
	// http://localhost:9090 exactly as before. A tagged release build sets
	// this to the hosted Agent Gateway's base URL (https://gateway.whiparc.com)
	// so `whiparc sandbox up` works for a hosted user with zero config.
	gatewayURLDefault = ""

	// apiURLDefault is gatewayURLDefault's counterpart for the API backend —
	// same injection mechanism, same tagged-release-only behavior. Until this
	// existed, every CLI build (including tagged releases) fell back to
	// http://localhost:8080 for APIURL with no hosted equivalent, so `whiparc
	// login` failed outright for a hosted user unless they passed --api-url
	// on every invocation or hand-edited ~/.whiparc/config.json.
	apiURLDefault = ""
)

func main() {
	var rootCmd = &cobra.Command{
		Use:     "whiparc",
		Short:   "Whiparc CLI - provision, validate, and manage workspaces.",
		Version: version,
		PersistentPreRun: func(cmd *cobra.Command, args []string) {
			configureUI()
		},
		Run: func(cmd *cobra.Command, args []string) {
			printBanner()
			_ = cmd.Help()
		},
	}
	rootCmd.SetVersionTemplate("whiparc version {{.Version}}\n")

	rootCmd.PersistentFlags().StringVar(&apiURLFlag, "api-url", "", "Override API backend URL (defaults to the config value, or https://api.whiparc.com in a tagged release build / http://localhost:8080 otherwise)")
	rootCmd.PersistentFlags().StringVar(&tokenFlag, "token", "", "Manually specify JWT token override")
	rootCmd.PersistentFlags().BoolVar(&noColorFlag, "no-color", false, "Disable colored output")

	// login
	var loginCmd = &cobra.Command{
		Use:   "login",
		Short: "Authenticate user session and store credentials locally",
		Run:   runLogin,
	}

	// logout
	var logoutCmd = &cobra.Command{
		Use:   "logout",
		Short: "Revoke active token and clear stored credentials",
		Run:   runLogout,
	}

	// projects
	var projectsCmd = &cobra.Command{
		Use:   "projects",
		Short: "Manage workspace projects",
	}

	var projectsListCmd = &cobra.Command{
		Use:   "list",
		Short: "List all accessible project workspaces",
		Run:   runProjectsList,
	}

	var projectsCreateCmd = &cobra.Command{
		Use:   "create",
		Short: "Create a new visual workspace project",
		Run:   runProjectsCreate,
	}
	projectsCreateCmd.Flags().String("name", "", "Name of the project")
	projectsCreateCmd.Flags().String("description", "Created via CLI", "Short description of the project")
	projectsCreateCmd.Flags().String("visibility", "PRIVATE", "Project visibility (PRIVATE | TEAM | PUBLIC)")

	var projectsDeleteCmd = &cobra.Command{
		Use:   "delete",
		Short: "Delete a project workspace",
		Run:   runProjectsDelete,
	}
	projectsDeleteCmd.Flags().String("id", "", "ID of the target project to delete")
	projectsDeleteCmd.Flags().Bool("force", false, "Force delete without verification prompt")

	projectsCmd.AddCommand(projectsListCmd, projectsCreateCmd, projectsDeleteCmd)

	// import
	var importCmd = &cobra.Command{
		Use:   "import",
		Short: "Parse and upload local IaC files to visual canvas",
		Run:   runImport,
	}
	importCmd.Flags().String("project", "", "Target project workspace ID")
	importCmd.Flags().StringP("file", "f", "", "Specific IaC configuration file to import")
	importCmd.Flags().StringP("dir", "d", "", "Directory containing IaC files to import")

	// deploy
	var deployCmd = &cobra.Command{
		Use:   "deploy",
		Short: "Execute deployment pipeline on canvas workspace",
		Run:   runDeploy,
	}
	deployCmd.Flags().String("project", "", "Target project workspace ID")
	deployCmd.Flags().Bool("auto-destroy", false, "Auto-destroy pipeline resources after deploy finishes")

	rootCmd.AddCommand(loginCmd, logoutCmd, projectsCmd, importCmd, deployCmd, configCmd(), sandboxCmd())

	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

// Helpers

// defaultGatewayURL is the fallback used whenever neither the config file
// nor a --gateway flag specifies one: the compiled-in release default if
// this binary was built from a tagged release, else localhost for local dev.
func defaultGatewayURL() string {
	if gatewayURLDefault != "" {
		return gatewayURLDefault
	}
	return "http://localhost:9090"
}

// defaultAPIURL mirrors defaultGatewayURL: a tagged release build gets the
// hosted API's base URL compiled in, everything else falls back to
// localhost.
func defaultAPIURL() string {
	if apiURLDefault != "" {
		return apiURLDefault
	}
	return "http://localhost:8080"
}

func getClientConfig() (*Config, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	path := filepath.Join(home, ".whiparc", "config.json")
	file, err := os.ReadFile(path)
	if err != nil {
		url := defaultAPIURL()
		if apiURLFlag != "" {
			url = apiURLFlag
		}
		return &Config{APIURL: url, GatewayURL: defaultGatewayURL()}, nil
	}
	var cfg Config
	_ = json.Unmarshal(file, &cfg)
	if apiURLFlag != "" {
		cfg.APIURL = apiURLFlag
	}
	if cfg.APIURL == "" {
		cfg.APIURL = defaultAPIURL()
	}
	if cfg.GatewayURL == "" {
		cfg.GatewayURL = defaultGatewayURL()
	}
	if tokenFlag != "" {
		cfg.Token = tokenFlag
	}
	return &cfg, nil
}

func saveClientConfig(cfg *Config) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	dir := filepath.Join(home, ".whiparc")
	_ = os.MkdirAll(dir, 0755)
	path := filepath.Join(dir, "config.json")
	data, _ := json.MarshalIndent(cfg, "", "  ")
	return os.WriteFile(path, data, 0600)
}

func makeRequest(method string, path string, payload interface{}, out interface{}) error {
	cfg, err := getClientConfig()
	if err != nil {
		return err
	}

	var body io.Reader
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}

	req, err := http.NewRequest(method, cfg.APIURL+path, body)
	if err != nil {
		return err
	}

	req.Header.Set("Content-Type", "application/json")
	if cfg.Token != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.Token)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API request failed with status %d: %s", resp.StatusCode, string(b))
	}

	if out != nil {
		return json.NewDecoder(resp.Body).Decode(out)
	}
	return nil
}

// Commands

func runLogin(cmd *cobra.Command, args []string) {
	cfg, err := getClientConfig()
	if err != nil {
		printError("Config error: %v", err)
		return
	}

	reader := bufio.NewReader(os.Stdin)

	fmt.Print("Enter Email: ")
	email, _ := reader.ReadString('\n')
	email = strings.TrimSpace(email)

	fmt.Print("Enter Password: ")
	bytePassword, err := term.ReadPassword(int(syscall.Stdin))
	if err != nil {
		fmt.Println()
		printError("Error reading password: %v", err)
		return
	}
	password := strings.TrimSpace(string(bytePassword))
	fmt.Println()

	payload := map[string]string{
		"email":    email,
		"password": password,
	}

	var result struct {
		Token string `json:"token"`
	}

	err = withSpinner("Authenticating...", func() error {
		return makeRequest("POST", "/api/auth/login", payload, &result)
	})
	if err != nil {
		printError("Login failed: %v", err)
		return
	}

	cfg.Token = result.Token
	err = saveClientConfig(cfg)
	if err != nil {
		printError("Failed to save credentials: %v", err)
		return
	}

	printSuccess("Successfully authenticated and logged in!")
}

func runLogout(cmd *cobra.Command, args []string) {
	cfg, err := getClientConfig()
	if err != nil {
		printError("Config error: %v", err)
		return
	}

	cfg.Token = ""
	_ = saveClientConfig(cfg)
	printSuccess("Credentials cleared. Logged out successfully.")
}

func runProjectsList(cmd *cobra.Command, args []string) {
	var projects []Project
	err := makeRequest("GET", "/api/projects", nil, &projects)
	if err != nil {
		printError("Failed to retrieve projects: %v", err)
		return
	}

	if len(projects) == 0 {
		printInfo("No projects found.")
		return
	}

	rows := make([][]string, len(projects))
	for i, p := range projects {
		rows[i] = []string{p.ID, p.Name, p.Visibility, p.TeamID}
	}
	printTable([]string{"PROJECT ID", "NAME", "VISIBILITY", "TEAM ID"}, rows)
}

func runProjectsCreate(cmd *cobra.Command, args []string) {
	name, _ := cmd.Flags().GetString("name")
	desc, _ := cmd.Flags().GetString("description")
	vis, _ := cmd.Flags().GetString("visibility")

	if name == "" {
		reader := bufio.NewReader(os.Stdin)
		fmt.Print("Enter Project Name: ")
		name, _ = reader.ReadString('\n')
		name = strings.TrimSpace(name)
	}

	// Fetch default team first
	var teams []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	err := makeRequest("GET", "/api/teams", nil, &teams)
	if err != nil || len(teams) == 0 {
		printError("Failed to load teams. Ensure you are logged in: %v", err)
		return
	}

	payload := map[string]string{
		"team_id":     teams[0].ID,
		"name":        name,
		"description": desc,
		"visibility":  strings.ToUpper(vis),
	}

	var newProj Project
	err = makeRequest("POST", "/api/projects", payload, &newProj)
	if err != nil {
		printError("Failed to create project: %v", err)
		return
	}

	printSuccess("Successfully created project %s (ID: %s)", newProj.Name, newProj.ID)
}

func runProjectsDelete(cmd *cobra.Command, args []string) {
	projID, _ := cmd.Flags().GetString("id")
	force, _ := cmd.Flags().GetBool("force")

	if projID == "" {
		reader := bufio.NewReader(os.Stdin)
		fmt.Print("Enter Project ID to delete: ")
		projID, _ = reader.ReadString('\n')
		projID = strings.TrimSpace(projID)
	}

	if !force {
		reader := bufio.NewReader(os.Stdin)
		fmt.Printf("%s Are you sure you want to delete project %s? [y/N]: ", styleWarn.Render("!"), projID)
		confirm, _ := reader.ReadString('\n')
		confirm = strings.TrimSpace(strings.ToLower(confirm))
		if confirm != "y" && confirm != "yes" {
			printInfo("Aborted deletion.")
			return
		}
	}

	err := makeRequest("DELETE", "/api/projects/"+projID, nil, nil)
	if err != nil {
		printError("Failed to delete project: %v", err)
		return
	}

	printSuccess("Project deleted successfully.")
}

// skippedImportDirs are directory names that collectIaCFiles never descends
// into. Pointing `import --dir` at a repository root otherwise uploads
// vendored module copies (.terraform/modules), git internals (.git), install
// trees (node_modules) and CI workflow files (.github), which can be
// thousands of files and shows up as confusing nodes on the canvas.
var skippedImportDirs = map[string]bool{
	".git":         true,
	".terraform":   true,
	"node_modules": true,
	".github":      true,
}

// collectIaCFiles walks dir and returns every .tf/.yml/.yaml file below it,
// skipping the directories in skippedImportDirs.
//
// Each returned FileItem.Name is the file's path relative to dir rather than
// its bare base name: a plain Base() makes two files with the same name in
// different folders collide in the upload payload.
func collectIaCFiles(dir string) ([]FileItem, error) {
	var files []FileItem

	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if info.IsDir() {
			if skippedImportDirs[info.Name()] {
				return filepath.SkipDir
			}
			return nil
		}

		switch strings.ToLower(filepath.Ext(path)) {
		case ".tf", ".yml", ".yaml":
		default:
			return nil
		}

		data, err := os.ReadFile(path)
		if err != nil {
			return nil
		}

		rel, err := filepath.Rel(dir, path)
		if err != nil {
			rel = filepath.Base(path)
		}

		files = append(files, FileItem{
			Name:    filepath.ToSlash(rel),
			Content: string(data),
		})

		return nil
	})
	if err != nil {
		return nil, err
	}

	return files, nil
}

func runImport(cmd *cobra.Command, args []string) {
	projectID, _ := cmd.Flags().GetString("project")
	filePath, _ := cmd.Flags().GetString("file")
	dirPath, _ := cmd.Flags().GetString("dir")

	if projectID == "" {
		printError("--project flag is required.")
		return
	}

	if filePath == "" && dirPath == "" {
		printError("Either --file (-f) or --dir (-d) flag must be specified.")
		return
	}

	var files []FileItem

	if filePath != "" {
		data, err := os.ReadFile(filePath)
		if err != nil {
			printError("Failed to read file %s: %v", filePath, err)
			return
		}
		files = append(files, FileItem{
			Name:    filepath.Base(filePath),
			Content: string(data),
		})
	} else {
		collected, err := collectIaCFiles(dirPath)
		if err != nil {
			printError("Failed to walk directory: %v", err)
			return
		}
		files = collected
	}

	if len(files) == 0 {
		printWarn("No supported config files (.tf, .yml, .yaml) found to import.")
		return
	}

	payload := map[string]interface{}{
		"files": files,
	}

	var result map[string]interface{}
	err := withSpinner(fmt.Sprintf("Importing %d file(s)...", len(files)), func() error {
		return makeRequest("POST", fmt.Sprintf("/api/projects/%s/import", projectID), payload, &result)
	})
	if err != nil {
		printError("Import failed: %v", err)
		return
	}

	printSuccess("%s", result["message"])
}

func runDeploy(cmd *cobra.Command, args []string) {
	projectID, _ := cmd.Flags().GetString("project")
	autoDestroy, _ := cmd.Flags().GetBool("auto-destroy")

	if projectID == "" {
		printError("--project flag is required.")
		return
	}

	payload := map[string]interface{}{
		"autoDestroy": autoDestroy,
	}

	var runResult struct {
		RunID  string `json:"runId"`
		Status string `json:"status"`
	}

	err := withSpinner("Triggering deploy pipeline...", func() error {
		return makeRequest("POST", fmt.Sprintf("/api/projects/%s/deploy", projectID), payload, &runResult)
	})
	if err != nil {
		printError("Deploy failed: %v", err)
		return
	}

	printInfo("Pipeline execution started. Run ID: %s. Status: %s", runResult.RunID, runResult.Status)
	fmt.Println(styleMuted.Render("Streaming execution logs in real-time:"))
	fmt.Println(styleMuted.Render(strings.Repeat("─", 60)))

	cfg, err := getClientConfig()
	if err != nil {
		return
	}

	// Connect to WS pipeline log stream
	u, err := url.Parse(cfg.APIURL)
	if err != nil {
		return
	}
	wsScheme := "ws"
	if u.Scheme == "https" {
		wsScheme = "wss"
	}
	wsURL := fmt.Sprintf("%s://%s/api/ws/runs/%s", wsScheme, u.Host, runResult.RunID)

	ws, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		printError("WebSocket connection failed: %v", err)
		return
	}
	defer ws.Close()

	for {
		_, message, err := ws.ReadMessage()
		if err != nil {
			break
		}

		var logMsg struct {
			Type    string `json:"type"`
			Message string `json:"message"`
			Status  string `json:"status"`
		}

		if err := json.Unmarshal(message, &logMsg); err == nil {
			if logMsg.Type == "log" {
				fmt.Print(logMsg.Message)
			} else if logMsg.Type == "status_change" {
				fmt.Println()
				fmt.Println(styleSystemLine(fmt.Sprintf("[SYSTEM] Pipeline status changed to: %s", logMsg.Status)))
				if logMsg.Status == "SUCCESS" || logMsg.Status == "FAILED" {
					break
				}
			}
		}
	}
	fmt.Println()
	fmt.Println(styleMuted.Render(strings.Repeat("─", 60)))
	printSuccess("Deploy pipeline execution complete.")
}
