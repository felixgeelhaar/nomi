package tools

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
)

// FolderContextTool scans a folder and returns its structure. The path passed
// to this tool is treated as the workspace root itself — scanning a folder is
// how a workspace root gets declared — so there is no parent root to enforce.
// If input also provides workspace_root, the scan target must resolve inside
// it, giving the runtime a way to keep context scans constrained.
type FolderContextTool struct{}

// NewFolderContextTool creates a new FolderContextTool
func NewFolderContextTool() *FolderContextTool {
	return &FolderContextTool{}
}

// Name returns the tool name
func (t *FolderContextTool) Name() string {
	return "filesystem.context"
}

// Capability returns the required capability
func (t *FolderContextTool) Capability() string {
	return "filesystem.read"
}

// Execute scans a folder and returns its structure.
func (t *FolderContextTool) Execute(ctx context.Context, input map[string]interface{}) (map[string]interface{}, error) {
	rawPath, ok := input["path"].(string)
	if !ok || rawPath == "" {
		return nil, fmt.Errorf("path is required")
	}

	root, err := WorkspaceRootFromInput(input)
	if err != nil {
		return nil, err
	}

	var target string
	if root != "" {
		// A root was declared: the scan target must live inside it.
		target, err = ResolveWithinRoot(root, rawPath)
		if err != nil {
			return nil, err
		}
	} else {
		// No root declared: the scan target is the root. Validate it exists
		// and is a directory.
		abs, err := filepath.Abs(rawPath)
		if err != nil {
			return nil, fmt.Errorf("invalid path: %w", err)
		}
		resolved, err := filepath.EvalSymlinks(abs)
		if err != nil {
			return nil, fmt.Errorf("path does not exist or is inaccessible: %w", err)
		}
		info, err := os.Stat(resolved)
		if err != nil {
			return nil, fmt.Errorf("failed to stat path: %w", err)
		}
		if !info.IsDir() {
			return nil, fmt.Errorf("path is not a directory: %s", rawPath)
		}
		target = resolved
	}

	maxDepth := 3
	if depth, ok := input["max_depth"].(float64); ok {
		maxDepth = int(depth)
	} else if depth, ok := input["max_depth"].(int); ok {
		maxDepth = depth
	}

	tree, err := scanFolder(target, 0, maxDepth)
	if err != nil {
		return nil, fmt.Errorf("failed to scan folder: %w", err)
	}
	stats, err := getFolderStats(target)
	if err != nil {
		return nil, fmt.Errorf("failed to get folder stats: %w", err)
	}

	return map[string]interface{}{
		"path":  target,
		"tree":  tree,
		"stats": stats,
	}, nil
}

// FileNode represents a file or directory in the tree
type FileNode struct {
	Name     string      `json:"name"`
	Type     string      `json:"type"` // "file" | "directory"
	Size     int64       `json:"size,omitempty"`
	Children []*FileNode `json:"children,omitempty"`
}

func scanFolder(path string, currentDepth, maxDepth int) (*FileNode, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}

	node := &FileNode{
		Name: info.Name(),
		Type: "file",
		Size: info.Size(),
	}

	if info.IsDir() {
		node.Type = "directory"

		if currentDepth < maxDepth {
			entries, err := os.ReadDir(path)
			if err != nil {
				return nil, err
			}

			for _, entry := range entries {
				name := entry.Name()
				if shouldIgnore(name) {
					continue
				}

				childPath := filepath.Join(path, name)
				child, err := scanFolder(childPath, currentDepth+1, maxDepth)
				if err != nil {
					continue // Skip inaccessible files
				}
				node.Children = append(node.Children, child)
			}
		}
	}

	return node, nil
}

// ignoredPatterns are directory/file names scanning skips by default. These
// are build artifacts and VCS metadata that only bloat the context without
// providing useful structural information.
var ignoredPatterns = map[string]bool{
	"node_modules": true,
	".git":         true,
	".hg":          true,
	".svn":         true,
	"vendor":       true,
	"dist":         true,
	"build":        true,
	"target":       true,
	"__pycache__":  true,
	".DS_Store":    true,
	".cache":       true,
	".next":        true,
}

func shouldIgnore(name string) bool {
	if name == "" || name == "." || name == ".." {
		return true
	}
	return ignoredPatterns[name]
}

func getFolderStats(path string) (map[string]interface{}, error) {
	var fileCount, dirCount, totalSize int64

	err := filepath.Walk(path, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip inaccessible files
		}

		if shouldIgnore(info.Name()) {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		if info.IsDir() {
			dirCount++
		} else {
			fileCount++
			totalSize += info.Size()
		}
		return nil
	})

	if err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"file_count": fileCount,
		"dir_count":  dirCount,
		"total_size": totalSize,
	}, nil
}
