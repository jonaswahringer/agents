package repo

import "testing"

func TestGitHubName(t *testing.T) {
	for url, want := range map[string]string{
		"git@github.com:jonaswahringer/tiro.git":  "jonaswahringer/tiro",
		"https://github.com/jonaswahringer/tiro":  "jonaswahringer/tiro",
		"https://github.com/jonaswahringer/tiro/": "jonaswahringer/tiro",
		"ssh://git@github.com/o/n.git":            "o/n",
		"https://gitlab.com/o/n.git":              "",
		"/srv/git/tiro.git":                       "",
		"https://github.com/o":                    "",
		"https://github.com/o/n/tree/main":        "",
	} {
		if got := GitHubName(url); got != want {
			t.Errorf("GitHubName(%q) = %q, want %q", url, got, want)
		}
	}
}
