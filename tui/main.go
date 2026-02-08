package main

import (
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"
)

func main() {
	baseURL := "http://localhost:3000"
	if v := os.Getenv("CLAUDE_HOST"); v != "" {
		baseURL = v
	}
	if len(os.Args) > 1 {
		baseURL = os.Args[1]
	}

	api := NewAPIClient(baseURL)

	for {
		m := NewDashboard(api)
		p := tea.NewProgram(m, tea.WithAltScreen())
		final, err := p.Run()
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			os.Exit(1)
		}

		result := final.(DashboardModel).result
		switch result.Action {
		case ActionQuit:
			return
		case ActionAttach:
			fmt.Print("\033[2J\033[H")
			// Set terminal title with detach hint (visible in tab/title bar)
			fmt.Printf("\033]2;%s · ctrl-a d to detach\007", result.SessionName)
			RunAttach(api, result.SessionName)
			fmt.Print("\033]2;\007") // reset title
			fmt.Print("\033[2J\033[H")
		}
	}
}
