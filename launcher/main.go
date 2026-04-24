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
	// Setup log file for GUI mode (stdout may not be visible in Windows GUI)
	logPath := filepath.Join(filepath.Dir(os.Args[0]), "launcher.log")
	logFile, _ := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	defer logFile.Close()
	log := func(format string, args ...interface{}) {
		msg := fmt.Sprintf(format, args...)
		fmt.Println(msg)
		logFile.WriteString(msg + "\n")
	}

	exePath, err := os.Executable()
	if err != nil {
		log("[错误] 无法获取程序路径")
		return
	}
	launcherDir := filepath.Dir(exePath)
	log("[启动器] 工作目录: " + launcherDir)

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
		log("[错误] 未找到 YesPlayMusic.exe")
		return
	}
	log("[启动器] 找到主程序: " + filepath.Base(appExe))

	// PORT env tells backend where to start probing
	env := os.Environ()
	env = append(env, "PORT=3001")
	env = append(env, "NODE_ENV=production")

	// Start the Electron app
	log("[启动器] 启动 YesPlayMusic...")
	cmd := exec.Command(appExe)
	cmd.Env = env
	cmd.Stdout = logFile
	cmd.Stderr = logFile

	if err := cmd.Start(); err != nil {
		log("[错误] 启动失败: " + err.Error())
		return
	}
	log(fmt.Sprintf("[启动器] 已启动, PID: %d", cmd.Process.Pid))

	// Wait for backend to be ready
	// Backend's findAvailablePort probes 3001->3010, returns first available
	// So we poll 3001..3010 and return when first one responds
	log("[启动器] 等待后端就绪 (3001-3010)")
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
		log("[警告] 后端就绪检测超时，使用默认端口 3001")
	} else {
		log(fmt.Sprintf("[启动器] 后端已就绪 (端口 %d)", actualPort))
	}

	log("[启动器] 启动完成!")

	// Wait for Electron app to exit
	cmd.Wait()
	log("[启动器] YesPlayMusic 已退出")
}
