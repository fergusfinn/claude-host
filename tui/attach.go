package main

import (
	"encoding/json"
	"os"
	"os/signal"
	"sync"
	"syscall"

	"github.com/gorilla/websocket"
	"golang.org/x/term"
)

type AttachResult int

const (
	Detached AttachResult = iota
	Disconnected
	AttachError
)

func RunAttach(api *APIClient, sessionName string) AttachResult {
	wsURL := api.WebSocketURL(sessionName)
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		return AttachError
	}
	defer conn.Close()

	// Raw mode
	fd := int(os.Stdin.Fd())
	oldState, err := term.MakeRaw(fd)
	if err != nil {
		return AttachError
	}
	defer term.Restore(fd, oldState)

	// Mutex for concurrent websocket writes
	var mu sync.Mutex
	wsSend := func(data []byte) error {
		mu.Lock()
		defer mu.Unlock()
		return conn.WriteMessage(websocket.TextMessage, data)
	}

	// Send terminal size
	sendResize := func() {
		w, h, err := term.GetSize(int(os.Stdout.Fd()))
		if err != nil {
			return
		}
		msg, _ := json.Marshal(map[string][]int{"resize": {w, h}})
		mu.Lock()
		conn.WriteMessage(websocket.TextMessage, msg)
		mu.Unlock()
	}
	sendResize()

	// SIGWINCH
	sigch := make(chan os.Signal, 1)
	signal.Notify(sigch, syscall.SIGWINCH)
	defer signal.Stop(sigch)

	done := make(chan AttachResult, 1)

	// WS -> stdout
	go func() {
		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				done <- Disconnected
				return
			}
			os.Stdout.Write(msg)
		}
	}()

	// SIGWINCH -> resize
	go func() {
		for range sigch {
			sendResize()
		}
	}()

	// stdin -> WS with Ctrl-A interception
	go func() {
		controlMode := false
		buf := make([]byte, 4096)
		for {
			n, err := os.Stdin.Read(buf)
			if err != nil {
				done <- AttachError
				return
			}

			data := buf[:n]
			i := 0
			for i < len(data) {
				if controlMode {
					controlMode = false
					switch data[i] {
					case 'd': // detach
						done <- Detached
						return
					case 0x01: // Ctrl-A again -> send literal
						if err := wsSend([]byte{0x01}); err != nil {
							done <- Disconnected
							return
						}
					}
					// unknown key: ignore
					i++
				} else {
					// Scan forward to next Ctrl-A or end
					j := i
					for j < len(data) && data[j] != 0x01 {
						j++
					}
					if j > i {
						if err := wsSend(data[i:j]); err != nil {
							done <- Disconnected
							return
						}
					}
					if j < len(data) && data[j] == 0x01 {
						controlMode = true
						j++
					}
					i = j
				}
			}
		}
	}()

	return <-done
}
