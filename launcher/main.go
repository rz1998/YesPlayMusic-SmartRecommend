package main

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

func main() {
	exePath, err := os.Executable()
	if err != nil {
		fmt.Println("[错误] 无法获取程序路径")
		fmt.Scanln()
		return
	}
	launcherDir := filepath.Dir(exePath)
	fmt.Printf("[启动器] 工作目录: %s\n", launcherDir)

	// Find the actual Electron app
	var appExe string
	for _, name := range []string{"YesPlayMusic-app.exe", "YesPlayMusic.exe"} {
		path := filepath.Join(launcherDir, name)
		if _, err := os.Stat(path); err == nil {
			appExe = path
			break
		}
	}
	if appExe == "" {
		fmt.Println("[错误] 未找到 YesPlayMusic.exe")
		fmt.Scanln()
		return
	}
	fmt.Printf("[启动器] 找到主程序: %s\n", filepath.Base(appExe))

	// PORT env tells backend where to start probing
	env := os.Environ()
	env = append(env, "PORT=3001")
	env = append(env, "NODE_ENV=production")

	// Start the Electron app
	fmt.Println("[启动器] 启动 YesPlayMusic...")
	cmd := exec.Command(appExe)
	cmd.Env = env
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		fmt.Println("[错误] 启动失败:", err)
		fmt.Scanln()
		return
	}
	fmt.Printf("[启动器] 已启动, PID: %d\n", cmd.Process.Pid)

	// Wait for backend to be ready
	// Backend's findAvailablePort probes 3001->3010, returns first available
	// So we poll 3001..3010 and return when first one responds
	fmt.Println("[启动器] 等待后端就绪 (3001-3010)")
	actualPort := 0
	for port := 3001; port <= 3010; port++ {
		for retry := 0; retry < 15; retry++ { // 15s per port
			conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), time.Second)
			if err == nil {
				conn.Close()
				actualPort = port
				break
			}
			time.Sleep(1 * time.Second)
		}
		if actualPort != 0 {
			break
		}
	}

	if actualPort == 0 {
		actualPort = 3001
		fmt.Println("[警告] 后端就绪检测超时，使用默认端口 3001")
	} else {
		fmt.Printf("[启动器] 后端已就绪 (端口 %d)\n", actualPort)
	}

	fmt.Println("[启动器] 启动完成!")
	fmt.Println()

	// Wait for Electron app to exit
	cmd.Wait()
	fmt.Println("[启动器] YesPlayMusic 已退出")
}
