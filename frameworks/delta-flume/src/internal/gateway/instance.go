package gateway

import (
	"bufio"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// InstanceDir is where a project keeps its vessel instances, relative to
// its top folder: one file per instance, in a folder per vessel type.
const InstanceDir = ".delta-flume/vessels"

// Paused reports whether a project has paused an instance of a vessel: the
// front matter of its .delta-flume/vessels/<vessel>/<instance>.md says
// "status: paused". A project without that file has not paused it.
func Paused(root, vessel, instance string) (bool, error) {
	file, err := os.Open(filepath.Join(root, filepath.FromSlash(InstanceDir), vessel, instance+".md"))
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	defer file.Close()

	lines := bufio.NewScanner(file)
	if !lines.Scan() || strings.TrimSpace(lines.Text()) != "---" {
		return false, lines.Err()
	}
	for lines.Scan() {
		line := strings.TrimSpace(lines.Text())
		if line == "---" {
			break
		}
		if name, value, ok := strings.Cut(line, ":"); ok && strings.TrimSpace(name) == "status" {
			return strings.TrimSpace(value) == "paused", nil
		}
	}
	return false, lines.Err()
}
