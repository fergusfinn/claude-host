package main

import (
	"fmt"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

type DashboardAction int

const (
	ActionNone DashboardAction = iota
	ActionAttach
	ActionQuit
)

type DashboardResult struct {
	Action      DashboardAction
	SessionName string
}

// Messages
type sessionsMsg []Session
type snapshotMsg string
type tickMsg time.Time
type errMsg struct{ err error }
type attachMsg string // session name to auto-attach
type summarizeMsg struct {
	name string
	desc string
	err  error
}

type inputMode int

const (
	modeNormal inputMode = iota
	modeDelete
)

type DashboardModel struct {
	api      *APIClient
	sessions []Session
	cursor   int
	snapshot string
	width    int
	height   int
	result      DashboardResult
	mode        inputMode
	creating    bool
	summarizing string // name of session being summarized, "" if idle
	err         error
}

func NewDashboard(api *APIClient) DashboardModel {
	return DashboardModel{api: api}
}

func (m DashboardModel) Init() tea.Cmd {
	return tea.Batch(m.fetchSessions(), m.tick())
}

func (m DashboardModel) fetchSessions() tea.Cmd {
	api := m.api
	return func() tea.Msg {
		sessions, err := api.ListSessions()
		if err != nil {
			return errMsg{err}
		}
		return sessionsMsg(sessions)
	}
}

func (m DashboardModel) fetchSnapshot() tea.Cmd {
	if m.cursor >= len(m.sessions) {
		return nil
	}
	api := m.api
	name := m.sessions[m.cursor].Name
	return func() tea.Msg {
		s, _ := api.GetSnapshot(name)
		return snapshotMsg(s)
	}
}

func (m DashboardModel) tick() tea.Cmd {
	return tea.Tick(3*time.Second, func(t time.Time) tea.Msg {
		return tickMsg(t)
	})
}

func (m DashboardModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch m.mode {
		case modeDelete:
			return m.updateDelete(msg)
		default:
			return m.updateNormal(msg)
		}

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case sessionsMsg:
		m.sessions = []Session(msg)
		m.err = nil
		if m.cursor >= len(m.sessions) {
			m.cursor = max(0, len(m.sessions)-1)
		}
		return m, m.fetchSnapshot()

	case snapshotMsg:
		m.snapshot = string(msg)
		return m, nil

	case tickMsg:
		return m, tea.Batch(m.fetchSessions(), m.tick())

	case attachMsg:
		m.result = DashboardResult{Action: ActionAttach, SessionName: string(msg)}
		return m, tea.Quit

	case summarizeMsg:
		m.summarizing = ""
		if msg.err == nil && msg.desc != "" {
			for i, s := range m.sessions {
				if s.Name == msg.name {
					m.sessions[i].Description = msg.desc
					break
				}
			}
		} else if msg.err != nil {
			m.err = msg.err
		}
		return m, nil

	case errMsg:
		m.err = msg.err
		m.creating = false
		return m, m.tick()
	}

	return m, nil
}

func (m DashboardModel) updateNormal(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "q", "ctrl+c":
		m.result = DashboardResult{Action: ActionQuit}
		return m, tea.Quit
	case "j", "down":
		if m.cursor < len(m.sessions)-1 {
			m.cursor++
			m.snapshot = ""
			return m, m.fetchSnapshot()
		}
	case "k", "up":
		if m.cursor > 0 {
			m.cursor--
			m.snapshot = ""
			return m, m.fetchSnapshot()
		}
	case "enter":
		if len(m.sessions) > 0 && m.cursor < len(m.sessions) {
			m.result = DashboardResult{
				Action:      ActionAttach,
				SessionName: m.sessions[m.cursor].Name,
			}
			return m, tea.Quit
		}
	case "c":
		if !m.creating {
			m.creating = true
			m.err = nil
			return m, m.createAndAttach()
		}
	case "s":
		if len(m.sessions) > 0 && m.summarizing == "" {
			name := m.sessions[m.cursor].Name
			m.summarizing = name
			api := m.api
			return m, func() tea.Msg {
				desc, err := api.Summarize(name)
				return summarizeMsg{name: name, desc: desc, err: err}
			}
		}
	case "S":
		if len(m.sessions) > 0 && m.summarizing == "" {
			m.summarizing = "all"
			api := m.api
			sessions := make([]Session, len(m.sessions))
			copy(sessions, m.sessions)
			return m, func() tea.Msg {
				for _, sess := range sessions {
					api.Summarize(sess.Name)
				}
				updated, err := api.ListSessions()
				if err != nil {
					return errMsg{err}
				}
				return sessionsMsg(updated)
			}
		}
	case "d":
		if len(m.sessions) > 0 {
			m.mode = modeDelete
		}
	}
	return m, nil
}

func (m DashboardModel) createAndAttach() tea.Cmd {
	api := m.api
	return func() tea.Msg {
		session, err := api.CreateSession("", "claude")
		if err != nil {
			return errMsg{err}
		}
		return attachMsg(session.Name)
	}
}

func (m DashboardModel) updateDelete(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "y", "Y":
		if m.cursor < len(m.sessions) {
			name := m.sessions[m.cursor].Name
			m.mode = modeNormal
			api := m.api
			return m, func() tea.Msg {
				_ = api.DeleteSession(name)
				sessions, err := api.ListSessions()
				if err != nil {
					return errMsg{err}
				}
				return sessionsMsg(sessions)
			}
		}
		m.mode = modeNormal
	default:
		m.mode = modeNormal
	}
	return m, nil
}

// Styles
var (
	titleStyle   = lipgloss.NewStyle().Bold(true)
	dimStyle     = lipgloss.NewStyle().Foreground(lipgloss.Color("240"))
	selStyle     = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("15"))
	normStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("250"))
	cmdStyle     = lipgloss.NewStyle().Foreground(lipgloss.Color("245"))
	tStyle       = lipgloss.NewStyle().Foreground(lipgloss.Color("240"))
	errSty       = lipgloss.NewStyle().Foreground(lipgloss.Color("1"))
	warnSty      = lipgloss.NewStyle().Foreground(lipgloss.Color("1")).Bold(true)
	promptSty    = lipgloss.NewStyle().Foreground(lipgloss.Color("6"))
	previewStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("248"))
)

func (m DashboardModel) View() string {
	var s strings.Builder

	s.WriteString("\n")
	s.WriteString("  " + titleStyle.Render("claude-host"))
	if len(m.sessions) > 0 {
		s.WriteString(dimStyle.Render(fmt.Sprintf("  %d sessions", len(m.sessions))))
	}
	s.WriteString("\n\n")

	if m.err != nil {
		s.WriteString("  " + errSty.Render(fmt.Sprintf("! %v", m.err)) + "\n\n")
	}

	if len(m.sessions) == 0 && m.err == nil {
		s.WriteString(dimStyle.Render("  No sessions running. Press c to create one.") + "\n")
	}

	for i, sess := range m.sessions {
		prefix := "  "
		nameS := normStyle
		if i == m.cursor {
			prefix = "▸ "
			nameS = selStyle
		}
		name := nameS.Render(fmt.Sprintf("%-22s", sess.Name))
		cmd := cmdStyle.Render(fmt.Sprintf("%-10s", sess.Command))
		age := tStyle.Render(timeAgo(sess.CreatedAt))
		s.WriteString(fmt.Sprintf("  %s%s %s %s\n", prefix, name, cmd, age))
		if sess.Description != "" {
			desc := sess.Description
			if m.width > 10 && len(desc) > m.width-10 {
				desc = desc[:m.width-10]
			}
			s.WriteString("    " + dimStyle.Render(desc) + "\n")
		} else if m.summarizing == sess.Name {
			s.WriteString("    " + dimStyle.Render("summarizing...") + "\n")
		}
	}

	// Preview of selected session
	if len(m.sessions) > 0 && m.snapshot != "" {
		s.WriteString("\n")
		w := 56
		if m.width > 8 {
			w = min(m.width-8, 72)
		}
		s.WriteString("  " + dimStyle.Render(strings.Repeat("─", w)) + "\n")

		lines := strings.Split(strings.TrimRight(m.snapshot, "\n"), "\n")
		maxLines := 10
		if m.height > 0 {
			avail := m.height - len(m.sessions) - 10
			if avail > 3 {
				maxLines = min(avail, 18)
			}
		}
		start := max(0, len(lines)-maxLines)
		for _, line := range lines[start:] {
			if m.width > 4 && len(line) > m.width-4 {
				line = line[:m.width-4]
			}
			s.WriteString("  " + previewStyle.Render(line) + "\n")
		}
	}

	// Footer
	s.WriteString("\n")
	switch m.mode {
	case modeDelete:
		if m.cursor < len(m.sessions) {
			s.WriteString("  " + warnSty.Render(fmt.Sprintf("delete %s? ", m.sessions[m.cursor].Name)))
			s.WriteString(dimStyle.Render("y/n") + "\n")
		}
	default:
		if m.creating {
			s.WriteString("  " + dimStyle.Render("creating session...") + "\n")
		} else if m.summarizing == "all" {
			s.WriteString("  " + dimStyle.Render("summarizing all sessions...") + "\n")
		} else {
			s.WriteString("  " + dimStyle.Render("↑↓ select  enter attach  c new  s summarize  d delete  q quit") + "\n")
		}
	}

	return s.String()
}
