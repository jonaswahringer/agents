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

// Instance is what flume reads from an instance file's front matter.
type Instance struct {
	// Paused: "status: paused". A paused instance starts nothing.
	Paused bool
	// Alerts names the channels that tell a human about the instance's
	// units, such as "alerts: github-issue". Several are separated by commas.
	Alerts []string
}

// ReadInstance reads the front matter of a project's
// .delta-flume/vessels/<vessel>/<instance>.md. A project without that file
// has an active instance with no alert channels.
func ReadInstance(root, vessel, instance string) (Instance, error) {
	var in Instance
	file, err := os.Open(filepath.Join(root, filepath.FromSlash(InstanceDir), vessel, instance+".md"))
	if errors.Is(err, fs.ErrNotExist) {
		return in, nil
	}
	if err != nil {
		return in, err
	}
	defer file.Close()

	lines := bufio.NewScanner(file)
	if !lines.Scan() || strings.TrimSpace(lines.Text()) != "---" {
		return in, lines.Err()
	}
	for lines.Scan() {
		line := strings.TrimSpace(lines.Text())
		if line == "---" {
			break
		}
		name, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		value = strings.TrimSpace(value)
		switch strings.TrimSpace(name) {
		case "status":
			in.Paused = value == "paused"
		case "alerts":
			for _, channel := range strings.Split(value, ",") {
				if channel = strings.TrimSpace(channel); channel != "" {
					in.Alerts = append(in.Alerts, channel)
				}
			}
		}
	}
	return in, lines.Err()
}
