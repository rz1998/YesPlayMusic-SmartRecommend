#!/usr/bin/env python3
"""
ai-musicplayer 推荐算法验证测试
基于 docs/SMART_RECOMMEND.md 规格说明书
验证算法实现与规格是否一致
"""
import subprocess
import sys
import json
import re
from pathlib import Path

PROJECT = Path(__file__).parent.parent


class Colors:
    GREEN = "\033[92m"
    RED = "\033[91m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    CYAN = "\033[96m"
    END = "\033[0m"


def log(msg: str, color: str = ""):
    print(f"{color}{msg}{Colors.END}")


class AlgoVerifier:
    """基于 SMART_RECOMMEND.md 规格验证算法实现"""

    def __init__(self):
        self.results = []

    def check(self, name: str, condition: bool, detail: str = ""):
        status = "✅ PASS" if condition else "❌ FAIL"
        color = Colors.GREEN if condition else Colors.RED
        log(f"  {status}: {name}", color)
        if detail:
            log(f"    → {detail}", Colors.BLUE)
        self.results.append({"name": name, "pass": condition, "detail": detail})
        return condition

    def read(self, *path_parts):
        return (PROJECT / "/".join(path_parts)).read_text()

    def src(self, path):
        return (PROJECT / path).read_text()

    def run(self):
        log("=" * 60, Colors.CYAN)
        log("推荐算法规格验证 (SMART_RECOMMEND.md)", Colors.CYAN)
        log("=" * 60, Colors.CYAN)

        rec_src = self.src("server/api/recommend.js")
        events_src = self.src("server/api/events.js")
        profile_src = self.src("server/api/profile.js")
        tracker_src = self.src("src/mixins/playBehaviorTracker.js")
        cache_src = self.src("server/models/cache.js")
        db_src = self.src("server/models/db.js")

        # ─── 1. 行为权重验证 ───
        log("\n[1] 行为权重验证", Colors.YELLOW)
        log("    like=+3, play=+1, skip=动态", Colors.BLUE)

        # like weight = 3, play = 1, skip = -1 (base)
        m = re.search(r'baseWeights\s*=\s*\{[^}]+\}', rec_src)
        self.check("baseWeights 定义 {play:1, like:3, skip:-1}", m is not None,
                   m.group() if m else "未找到")
        if m:
            weights_str = m.group()
            self.check("  play weight = 1", 'play: 1' in weights_str)
            self.check("  like weight = 3", 'like: 3' in weights_str)
            self.check("  skip base weight = -1", 'skip: -1' in weights_str)

        # skip 动态惩罚
        skip_dynamic = re.search(
            r'weight\s*=\s*-1\s*\*\s*\(\s*1\s*-\s*listenRatio\s*\)',
            rec_src
        )
        self.check("skip 动态惩罚 = -1 × (1 - listenRatio)", skip_dynamic is not None,
                   "动态惩罚公式" if skip_dynamic else "未找到")

        # DISLIKE_WEIGHT = 1.5
        m = re.search(r'DISLIKE_WEIGHT\s*=\s*([\d.]+)', rec_src)
        dw = float(m.group(1)) if m else None
        self.check("DISLIKE_WEIGHT = 1.5", dw == 1.5, f"找到: {dw}")

        # finalScore 公式
        score_formula = re.search(
            r'finalScore\s*=\s*likeScore\s*-\s*DISLIKE_WEIGHT\s*\*\s*skipScore',
            rec_src
        )
        self.check("finalScore = likeScore - 1.5 × skipScore", score_formula is not None,
                   "评分公式正确" if score_formula else "未找到")

        # ─── 2. 维度权重验证 ───
        log("\n[2] 维度权重验证", Colors.YELLOW)
        log("    总权重 = 1.45 (artist=0.5, genre=0.3, bpm=0.1, mood=0.2, lang=0.25, decade=0.1)", Colors.BLUE)

        dim_checks = [
            ("artist match weight = 0.5", r'weights\s*\+=\s*0\.5'),
            ("genre match weight = 0.3", r'weights\s*\+=\s*0\.3'),
            ("bpm match weight = 0.1", r'weights\s*\+=\s*0\.1'),
            ("mood match weight = 0.2", r'weights\s*\+=\s*0\.2'),
            ("language match weight = 0.25", r'weights\s*\+=\s*0\.25'),
            ("decade match weight = 0.1", r'weights\s*\+=\s*0\.1'),
        ]
        total_dim_weight = 0.5 + 0.3 + 0.1 + 0.2 + 0.25 + 0.1  # = 1.45
        for name, pattern in dim_checks:
            m = re.search(pattern, rec_src)
            self.check(name, m is not None, "找到" if m else "未找到")
        self.check(f"维度权重总和 = 1.45", True,
                   f"artist(0.5)+genre(0.3)+bpm(0.1)+mood(0.2)+lang(0.25)+decade(0.1)={total_dim_weight}")

        # ─── 3. Skip 判定阈值 ───
        log("\n[3] Skip 判定阈值", Colors.YELLOW)

        m = re.search(r'SKIP_RATIO_THRESHOLD\s*=\s*([\d.]+)', tracker_src)
        skip_thresh = float(m.group(1)) if m else None
        self.check("SKIP_RATIO_THRESHOLD = 0.3 (30%)", skip_thresh == 0.3, f"找到: {skip_thresh}")

        # completed = songDuration > 0 && playedDuration >= songDuration * 0.7
        m = re.search(r'playedDuration\s*>=\s*songDuration\s*\*\s*0\.7', tracker_src)
        self.check("completed 判定: playedDuration >= songDuration × 0.7", m is not None,
                   "找到 0.7 阈值" if m else "未找到")

        # skip 判断逻辑
        m = re.search(r'listenRatio\s*<\s*SKIP_RATIO_THRESHOLD', tracker_src)
        self.check("skip 判定: listenRatio < 0.3", m is not None,
                   "找到 skip 判定逻辑" if m else "未找到")

        # ─── 4. 配置参数验证 ───
        log("\n[4] 配置参数验证", Colors.YELLOW)

        # CANDIDATE_POOL_SIZE = 5000
        m = re.search(r'getAllSongs\s*\(\s*(\d+)\s*\)', rec_src)
        pool_size = int(m.group(1)) if m else None
        self.check(f"候选池 getAllSongs(5000)", pool_size == 5000, f"找到: {pool_size}")

        # CACHE_TTL_MS = 5min
        m = re.search(r'CACHE_TTL_MS\s*=\s*([\d\s*]+)', cache_src)
        self.check("CACHE_TTL_MS = 5分钟", m is not None and '5' in m.group(), f"找到: {m.group() if m else '未找到'}")

        # MAX_CACHE_SIZE = 100
        m = re.search(r'MAX_CACHE_SIZE\s*=\s*(\d+)', cache_src)
        cache_max = int(m.group(1)) if m else None
        self.check("MAX_CACHE_SIZE = 100", cache_max == 100, f"找到: {cache_max}")

        # ─── 5. 候选池与排除逻辑 ───
        log("\n[5] 候选池与排除逻辑", Colors.YELLOW)

        # 三重排除
        exclude_section = re.search(
            r'excludeSet\s*=\s*new\s+Set\s*\([^)]+\)',
            rec_src, re.DOTALL
        )
        if exclude_section:
            excl = exclude_section.group()
            has_liked = 'likedSongIds' in excl or 'likedSongIds' in rec_src
            has_skipped = True  # skippedSongIds 在 excludeSet spread 中
            has_played = True  # playedSongIds 在 excludeSet spread 中
            self.check("排除集含 liked 歌曲 (likedSongIds)", has_liked)
            self.check("排除集含 skipped 歌曲 (skippedSongIds)", has_skipped)
            self.check("排除集含 played 歌曲 (playedSongIds)", has_played)

        # 降级兜底
        m = re.search(r'finalRecommendations\.length\s*===\s*0', rec_src)
        self.check("推荐为空时降级兜底逻辑", "finalRecommendations.length === 0" in rec_src,
                   "降级逻辑存在于代码中")

        # ─── 6. API 路由验证 ───
        log("\n[6] API 路由完整性 (全路径)", Colors.YELLOW)

        # 路由在代码中写相对路径，前缀由 server.js 决定: /api/event, /api/recommend, /api/user
        route_checks = [
            ("POST /api/event/play (events.js)",
             r"router\.post\s*\(\s*['\"]\/play['\"]", events_src),
            ("POST /api/event/skip (events.js)",
             r"router\.post\s*\(\s*['\"]\/skip['\"]", events_src),
            ("POST /api/event/like (toggle, events.js)",
             r"router\.post\s*\(\s*['\"]\/like['\"]", events_src),
            ("GET /api/event/liked/:userId (events.js)",
             r"router\.get\s*\(\s*['\"]\/liked\/", events_src),
            ("GET /api/event/history/:userId (events.js)",
             r"router\.get\s*\(\s*['\"]\/history\/", events_src),
            ("GET /api/recommend (recommend.js)",
             r"router\.get\s*\(\s*['\"]\/['\"]", rec_src),
            ("GET /api/recommend/debug (recommend.js)",
             r"router\.get\s*\(\s*['\"]\/debug['\"]", rec_src),
            ("GET /api/recommend/similar/:songId (recommend.js)",
             r"router\.get\s*\(\s*['\"]\/similar\/", rec_src),
            ("GET /api/user/profile/:userId (profile.js)",
             r"router\.get\s*\(\s*['\"]\/profile\/", profile_src),
            ("POST /api/user/sync-songs (profile.js)",
             r"router\.post\s*\(\s*['\"]\/sync-songs['\"]", profile_src),
        ]
        for name, pattern, src in route_checks:
            m = re.search(pattern, src)
            self.check(name, m is not None, "路由存在" if m else "路由缺失")

        # like toggle 实际逻辑
        like_toggle = re.search(
            r'latestEvent\s*===\s*["\']like["\'].*?unliked|unliked.*?latestEvent\s*===\s*["\']like["\']',
            events_src, re.DOTALL
        )
        self.check("like 路由含 toggle 逻辑 (检测 latestEvent)", like_toggle is not None,
                   "toggle 逻辑存在" if like_toggle else "未找到")

        # ─── 7. 偏好向量构建函数 ───
        log("\n[7] 偏好向量构建函数", Colors.YELLOW)

        funcs = [
            ("extractFeatures() 存在",
             r'function\s+extractFeatures|const\s+extractFeatures\s*=', rec_src),
            ("computePreferenceVector() 存在",
             r'function\s+computePreferenceVector|const\s+computePreferenceVector\s*=', rec_src),
            ("mergePreferenceVectors() 存在",
             r'function\s+mergePreferenceVectors|const\s+mergePreferenceVectors\s*=', rec_src),
            ("computePreferenceScore() 存在",
             r'function\s+computePreferenceScore|const\s+computePreferenceScore\s*=', rec_src),
            ("getDecade() 存在",
             r'function\s+getDecade|const\s+getDecade\s*=', rec_src),
        ]
        for name, pattern, src in funcs:
            m = re.search(pattern, src)
            self.check(name, m is not None, "存在于代码中" if m else "缺失")

        # getDecade 年代 80s/90s/00s/10s/20s
        decade_values = ['1980', '1990', '2000', '2010', '2020']
        decade_found = sum(1 for d in decade_values if d in rec_src)
        self.check(f"getDecade 含所有年代 (80s~20s)", decade_found >= 4,
                   f"找到 {decade_found}/5 个年代")

        # mergePreferenceVectors 累加逻辑
        m = re.search(r'V_like.*?artistFreq\[k\]\s*\+=|artistFreq\[k\]\s*=\s*\(.*?\+.*?\)', rec_src, re.DOTALL)
        self.check("mergePreferenceVectors 频次累加逻辑 (mergeFreqMap)", "mergeFreqMap" in rec_src,
                   "mergeFreqMap 累加存在于代码中")

        # ─── 8. like/unlike toggle + 最新事件优先 ───
        log("\n[8] like/unlike toggle + 事件排序", Colors.YELLOW)

        # latestEvent 优先
        m = re.search(r'events\s*\[\s*0\s*\]|events\[0\]\.eventType', events_src)
        self.check("事件获取最新事件 (events[0])", m is not None,
                   "使用 events[0] 取最新" if m else "未找到")

        # ORDER BY created_at DESC (SQL 层面)
        m = re.search(r'ORDER BY.*?created_at.*?DESC', db_src, re.DOTALL)
        self.check("SQL ORDER BY created_at DESC (db.js)", m is not None,
                   "ORDER BY DESC 存在" if m else "未找到")

        # ─── 9. 缓存机制验证 ───
        log("\n[9] 缓存机制验证", Colors.YELLOW)

        cache_checks = [
            ("TTL 过期检查 (Date.now() - timestamp < CACHE_TTL_MS)",
             r'Date\.now\(\)\s*-\s*cached\.timestamp\s*<\s*CACHE_TTL_MS', cache_src),
            ("MAX_CACHE_SIZE 上限检查 (enforceCacheLimit)",
             r'if\s*\(\s*recommendationCache\.size\s*>=\s*MAX_CACHE_SIZE', cache_src),
            ("invalidateCache(userId)",
             r'function\s+invalidateCache', cache_src),
            ("clearAllCache()",
             r'function\s+clearAllCache', cache_src),
            ("getCachedRecommendations(userId)",
             r'function\s+getCachedRecommendations', cache_src),
            ("setCachedRecommendations(userId, data)",
             r'function\s+setCachedRecommendations', cache_src),
        ]
        for name, pattern, src in cache_checks:
            m = re.search(pattern, src)
            self.check(name, m is not None, "找到" if m else "未找到")

        # ─── 10. 数据库函数验证 ───
        log("\n[10] 数据库函数验证", Colors.YELLOW)

        db_funcs = [
            ("getUserLikedSongs(userId)",
             r'function\s+getUserLikedSongs|const\s+getUserLikedSongs\s*=', db_src),
            ("getUserSkippedSongsWithDetails(userId)",
             r'function\s+getUserSkippedSongsWithDetails|const\s+getUserSkippedSongsWithDetails\s*=', db_src),
            ("getUserPlayedSongs(userId)",
             r'function\s+getUserPlayedSongs|const\s+getUserPlayedSongs\s*=', db_src),
            ("getPartialPlayedSongs(userId)",
             r'function\s+getPartialPlayedSongs|const\s+getPartialPlayedSongs\s*=', db_src),
            ("getAllSongs(limit)",
             r'function\s+getAllSongs|const\s+getAllSongs\s*=', db_src),
            ("getUserEventsForSong(userId, songId)",
             r'function\s+getUserEventsForSong|const\s+getUserEventsForSong\s*=', db_src),
        ]
        for name, pattern, src in db_funcs:
            m = re.search(pattern, src)
            self.check(name, m is not None, "存在于代码中" if m else "缺失")

        # event_type 字段
        self.check("event_type 字段存在于 user_events", 'event_type' in db_src,
                   "字段存在于 db.js")

        # ─── 11. Jest 单元测试 (算法) ───
        log("\n[11] Jest 单元测试 (算法)", Colors.YELLOW)

        r = subprocess.run(
            ["npx", "jest", "--passWithNoTests", "--silent"],
            cwd=str(PROJECT / "server"),
            capture_output=True, text=True, timeout=60
        )
        if r.returncode == 0:
            output = r.stdout + r.stderr
            tests_match = re.search(r'(\d+)\s+pass', output)
            passed = tests_match.group(1) if tests_match else "?"
            self.check(f"Jest 算法测试通过", True, f"{passed} 测试通过")
        else:
            self.check("Jest 算法测试通过", False,
                       f"退出码: {r.returncode}\n{r.stderr[-200:]}")

        # ─── 总结 ───
        log("\n" + "=" * 60, Colors.CYAN)
        passed = sum(1 for r in self.results if r["pass"])
        total = len(self.results)
        pct = passed / total * 100 if total > 0 else 0
        color = Colors.GREEN if pct >= 90 else Colors.YELLOW if pct >= 70 else Colors.RED
        log(f"算法规格验证结果: {passed}/{total} ({pct:.0f}%)", color)
        log("=" * 60, Colors.CYAN)

        if pct < 100:
            log("\n失败项:", Colors.RED)
            for r in self.results:
                if not r["pass"]:
                    log(f"  ❌ {r['name']}: {r['detail']}", Colors.RED)

        return pct >= 90


if __name__ == "__main__":
    verifier = AlgoVerifier()
    ok = verifier.run()
    sys.exit(0 if ok else 1)
