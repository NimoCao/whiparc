package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
	"gopkg.in/yaml.v3"
)

type ValidationError struct {
	Line    int    `json:"line"`
	Column  int    `json:"column"`
	Message string `json:"message"`
}

type ValidationResponse struct {
	Valid           bool              `json:"valid"`
	Errors          []ValidationError `json:"errors"`
	ExtractedParams []string          `json:"extracted_params"`
}

type CustomNode struct {
	ID             string    `json:"id"`
	ProjectID      string    `json:"project_id"`
	CreatedBy      string    `json:"created_by"`
	Title          string    `json:"title"`
	Tech           string    `json:"tech"`
	Category       string    `json:"category"`
	Description    string    `json:"description"`
	CodeType       string    `json:"code_type"`
	RawCode        string    `json:"raw_code"`
	ParsedMetaJSON string    `json:"parsed_meta_json"`
	CreatedAt      time.Time `json:"created_at"`
}

// POST /api/custom-nodes/validate
func handleValidateCustomNode(w http.ResponseWriter, r *http.Request) {
	// Enable CORS if requested
	w.Header().Set("Access-Control-Allow-Origin", allowedOrigin())
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	var payload struct {
		Tech     string `json:"tech"`
		CodeType string `json:"code_type"`
		RawCode  string `json:"raw_code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload: "+err.Error(), http.StatusBadRequest)
		return
	}

	var resp ValidationResponse
	resp.Valid = true
	resp.Errors = []ValidationError{}
	resp.ExtractedParams = []string{}

	code := payload.RawCode

	switch strings.ToLower(payload.Tech) {
	case "terraform":
		file, diags := hclsyntax.ParseConfig([]byte(code), "custom.tf", hcl.InitialPos)
		if diags.HasErrors() {
			resp.Valid = false
			for _, diag := range diags {
				if diag.Severity == hcl.DiagError {
					err := ValidationError{
						Line:    diag.Subject.Start.Line,
						Column:  diag.Subject.Start.Column,
						Message: diag.Summary,
					}
					if diag.Detail != "" {
						err.Message += ": " + diag.Detail
					}
					resp.Errors = append(resp.Errors, err)
				}
			}
		} else {
			body, ok := file.Body.(*hclsyntax.Body)
			if ok {
				for _, block := range body.Blocks {
					if block.Type == "variable" && len(block.Labels) > 0 {
						resp.ExtractedParams = append(resp.ExtractedParams, block.Labels[0])
					}
				}
			}
		}

	case "ansible":
		var out interface{}
		err := yaml.Unmarshal([]byte(code), &out)
		if err != nil {
			resp.Valid = false
			line, col, msg := parseYAMLError(err.Error())
			resp.Errors = append(resp.Errors, ValidationError{
				Line:    line,
				Column:  col,
				Message: msg,
			})
		} else {
			re := regexp.MustCompile(`\{\{\s*([a-zA-Z0-9_\-]+)\s*\}\}`)
			matches := re.FindAllStringSubmatch(code, -1)
			seen := make(map[string]bool)
			for _, match := range matches {
				if len(match) > 1 && !seen[match[1]] {
					seen[match[1]] = true
					resp.ExtractedParams = append(resp.ExtractedParams, match[1])
				}
			}
		}

	case "kubernetes":
		var out interface{}
		err := yaml.Unmarshal([]byte(code), &out)
		if err != nil {
			resp.Valid = false
			line, col, msg := parseYAMLError(err.Error())
			resp.Errors = append(resp.Errors, ValidationError{
				Line:    line,
				Column:  col,
				Message: msg,
			})
		} else {
			m, ok := out.(map[string]interface{})
			if ok {
				if _, ok := m["kind"]; !ok {
					resp.Valid = false
					resp.Errors = append(resp.Errors, ValidationError{
						Line:    1,
						Column:  1,
						Message: "Kubernetes manifest must specify a 'kind' (e.g. Deployment, Service)",
					})
				}
				if _, ok := m["apiVersion"]; !ok {
					resp.Valid = false
					resp.Errors = append(resp.Errors, ValidationError{
						Line:    1,
						Column:  1,
						Message: "Kubernetes manifest must specify 'apiVersion' (e.g. apps/v1, v1)",
					})
				}
			} else {
				resp.Valid = false
				resp.Errors = append(resp.Errors, ValidationError{
					Line:    1,
					Column:  1,
					Message: "Kubernetes manifest must be a valid key-value configuration block",
				})
			}
		}

	default:
		resp.Valid = false
		resp.Errors = append(resp.Errors, ValidationError{
			Line:    1,
			Column:  1,
			Message: "Unsupported technology: " + payload.Tech,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

func parseYAMLError(errStr string) (int, int, string) {
	line := 1
	col := 1
	msg := errStr

	reLineCol := regexp.MustCompile(`line\s+(\d+),\s+column\s+(\d+)`)
	reLine := regexp.MustCompile(`line\s+(\d+)`)

	if m := reLineCol.FindStringSubmatch(errStr); len(m) > 2 {
		_, _ = fmt.Sscanf(m[1], "%d", &line)
		_, _ = fmt.Sscanf(m[2], "%d", &col)
	} else if m := reLine.FindStringSubmatch(errStr); len(m) > 1 {
		_, _ = fmt.Sscanf(m[1], "%d", &line)
	}

	msg = strings.TrimPrefix(msg, "yaml: ")
	return line, col, msg
}

// GET /api/projects/{id}/custom-nodes
func handleGetCustomNodes(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")

	rows, err := db.Query(`
		SELECT id, project_id, created_by, title, tech, category, description, code_type, raw_code, parsed_meta_json, created_at 
		FROM custom_nodes 
		WHERE project_id = ? 
		ORDER BY created_at DESC`, projectID)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var nodes []CustomNode
	for rows.Next() {
		var n CustomNode
		var createdStr string
		err := rows.Scan(&n.ID, &n.ProjectID, &n.CreatedBy, &n.Title, &n.Tech, &n.Category, &n.Description, &n.CodeType, &n.RawCode, &n.ParsedMetaJSON, &createdStr)
		if err != nil {
			http.Error(w, "Failed to read record: "+err.Error(), http.StatusInternalServerError)
			return
		}
		n.CreatedAt, _ = time.Parse("2006-01-02 15:04:05", strings.Replace(createdStr, "T", " ", 1))
		nodes = append(nodes, n)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(nodes)
}

// POST /api/projects/{id}/custom-nodes
func handleCreateCustomNode(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	user, ok := GetUserFromContext(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if msg := customNodeLimitMessage(projectID); msg != "" {
		writePlanLimit(w, msg)
		return
	}

	var payload struct {
		Title       string `json:"title"`
		Tech        string `json:"tech"`
		Category    string `json:"category"`
		Description string `json:"description"`
		CodeType    string `json:"code_type"`
		RawCode     string `json:"raw_code"`
		MetaJSON    string `json:"parsed_meta_json"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid payload: "+err.Error(), http.StatusBadRequest)
		return
	}

	nodeID := fmt.Sprintf("cust_%d", time.Now().UnixNano())
	category := payload.Category
	if category == "" {
		category = "Custom Blocks"
	}

	_, err := db.Exec(`
		INSERT INTO custom_nodes (id, project_id, created_by, title, tech, category, description, code_type, raw_code, parsed_meta_json)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		nodeID, projectID, user.ID, payload.Title, payload.Tech, category, payload.Description, payload.CodeType, payload.RawCode, payload.MetaJSON)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"id":      nodeID,
		"message": "Custom node template created successfully",
	})
}

// DELETE /api/projects/{id}/custom-nodes/{nodeId}
func handleDeleteCustomNode(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	nodeID := r.PathValue("nodeId")

	_, err := db.Exec("DELETE FROM custom_nodes WHERE id = ? AND project_id = ?", nodeID, projectID)
	if err != nil {
		http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"message": "Custom node template deleted successfully"})
}
