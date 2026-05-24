import { useState } from "react";

const STORAGE_KEY = "follow_blue_oval_app_v1";

const youtubeMockCreators = [
  "Peter McKinnon",
  "Sara Dietschy",
  "MKBHD",
  "The Futur",
  "BestDressed",
  "Vogue"
];

const initialPlatforms = [
  {
    id: "youtube",
    name: "YouTube",
    syncType: "mock",
    homepageUrl: "https://www.youtube.com",
    connected: false,
    creators: []
  },
  {
    id: "xiaohongshu",
    name: "小红书",
    syncType: "manual",
    homepageUrl: "https://www.xiaohongshu.com",
    connected: false,
    creators: []
  },
  {
    id: "weibo",
    name: "微博",
    syncType: "manual",
    homepageUrl: "https://weibo.com",
    connected: false,
    creators: []
  },
  {
    id: "rss",
    name: "RSS",
    syncType: "rss",
    homepageUrl: "",
    connected: false,
    creators: []
  }
];

function createCreator(platformId, name, homepageUrl, sourceId, updates = []) {
  return {
    id: `${platformId}-${sourceId}`,
    name,
    avatar: name.slice(0, 1).toUpperCase(),
    homepageUrl,
    sourceId,
    selected: true,
    updates
  };
}

function createUpdate(id, time, title, url, read = false) {
  return {
    id,
    title,
    url,
    time,
    read
  };
}

function loadPlatforms() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? normalizePlatforms(JSON.parse(saved)) : initialPlatforms;
  } catch {
    return initialPlatforms;
  }
}

function normalizePlatforms(platforms) {
  const platformMap = new Map(Array.isArray(platforms) ? platforms.map((platform) => [platform.id, platform]) : []);

  return initialPlatforms.map((defaultPlatform) => {
    const savedPlatform = platformMap.get(defaultPlatform.id);
    if (!savedPlatform) return defaultPlatform;

    return {
      ...defaultPlatform,
      ...savedPlatform,
      creators: normalizeCreators(savedPlatform)
    };
  });
}

function normalizeCreators(platform) {
  if (Array.isArray(platform.creators)) {
    return platform.creators.map((creator) => ({
      ...creator,
      avatar: creator.avatar || creator.name?.slice(0, 1).toUpperCase() || "?",
      selected: creator.selected !== false,
      updates: Array.isArray(creator.updates) ? creator.updates : []
    }));
  }

  if (!Array.isArray(platform.updates)) {
    return [];
  }

  return platform.updates.map((update) =>
    createCreator(
      platform.id,
      update.creator,
      update.url,
      `legacy-${update.id}`,
      [createUpdate(update.id, update.time, update.title, update.url, update.read)]
    )
  );
}

function savePlatforms(platforms) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(platforms));
}

function getUnreadCreators(platform) {
  return platform.creators
    .filter((creator) => creator.selected !== false)
    .map((creator) => ({
      ...creator,
      unreadUpdates: creator.updates.filter((update) => !update.read)
    }))
    .filter((creator) => creator.unreadUpdates.length > 0);
}

function getAllReadUpdates(platform) {
  return platform.creators.flatMap((creator) =>
    creator.updates
      .filter((update) => update.read)
      .map((update) => ({
        ...update,
        creatorName: creator.name
      }))
  );
}

function normalizeUrl(url) {
  if (!url) return "";

  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  return `https://${url}`;
}

function getCurrentTime() {
  const now = new Date();
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}

function getYoutubeHomepage(name) {
  const slug = name.toLowerCase().replaceAll(" ", "");
  return `https://www.youtube.com/@${slug}`;
}

function getMockUpdateTitle(name) {
  const titles = {
    "Peter McKinnon": "My Camera Bag 2026",
    "Sara Dietschy": "Tech Desk Setup",
    MKBHD: "What’s New This Week",
    "The Futur": "Design systems that actually scale",
    BestDressed: "Closet refresh before summer",
    Vogue: "Inside a quiet morning routine"
  };

  return titles[name] || `${name} 发布了新内容`;
}

function getStatusText(platform, unreadCreators) {
  const isConnected = platform.connected || platform.creators.length > 0;

  if (!isConnected) {
    if (platform.id === "youtube") return "可自动同步";
    if (platform.id === "rss") return "添加订阅源";
    if (platform.id === "weibo") return "手动添加链接 / 后续尝试关联";
    return "手动添加链接";
  }

  if (unreadCreators.length > 0) {
    if (platform.id === "rss") return `${unreadCreators.length} 个订阅源更新`;
    return `${unreadCreators.length} 位博主更新`;
  }

  return "暂无新更新";
}

function getConnectedNote(platform) {
  if (platform.id === "rss") return "已添加订阅源，等待下一次同步";
  if (platform.id === "youtube") return "已关联，等待下一次模拟同步";
  return "已添加博主，暂无新更新";
}

function getActionText(platform) {
  if (platform.id === "youtube") return "关联 YouTube";
  if (platform.id === "xiaohongshu") return "添加小红书博主";
  if (platform.id === "weibo") return "添加微博博主";
  return "添加 RSS";
}

function isMockOrEmptyUrl(url) {
  if (!url) return true;

  const normalizedUrl = String(url).trim().toLowerCase();
  return normalizedUrl === "" || normalizedUrl === "#" || normalizedUrl === "about:blank";
}

export default function App() {
  const [platforms, setPlatforms] = useState(loadPlatforms);
  const [activePlatformId, setActivePlatformId] = useState(null);
  const [manualPlatformId, setManualPlatformId] = useState(null);
  const [connectPlatformId, setConnectPlatformId] = useState(null);
  const [activeTab, setActiveTab] = useState("home");

  const activePlatform = platforms.find((platform) => platform.id === activePlatformId);
  const connectPlatform = platforms.find((platform) => platform.id === connectPlatformId);
  const manualPlatform = platforms.find((platform) => platform.id === manualPlatformId);

  function updatePlatforms(nextPlatforms) {
    const normalizedPlatforms = normalizePlatforms(nextPlatforms);
    setPlatforms(normalizedPlatforms);
    savePlatforms(normalizedPlatforms);
  }

  function openHome() {
    setActiveTab("home");
    setActivePlatformId(null);
  }

  function markUpdateAsRead(platformId, creatorId, updateId) {
    const nextPlatforms = platforms.map((platform) => {
      if (platform.id !== platformId) return platform;

      return {
        ...platform,
        creators: platform.creators.map((creator) => {
          if (creator.id !== creatorId) return creator;

          return {
            ...creator,
            updates: creator.updates.map((update) => {
              if (update.id !== updateId) return update;
              return {
                ...update,
                read: true
              };
            })
          };
        })
      };
    });

    updatePlatforms(nextPlatforms);
  }

  function openExternalLink({ platform, creator, update }) {
    const hasAnyLink = Boolean(update?.url || creator?.homepageUrl || platform?.homepageUrl);

    if (!hasAnyLink) {
      alert("当前还没有可打开的真实链接");
      return;
    }

    const finalUrl = update?.url || creator?.homepageUrl || platform?.homepageUrl;

    if (isMockOrEmptyUrl(finalUrl)) {
      alert("当前是模拟内容，暂无真实链接。你可以在详情页右上角手动添加真实链接。");
      return;
    }

    if (update?.id && creator?.id && platform?.id) {
      markUpdateAsRead(platform.id, creator.id, update.id);
    }

    window.location.href = normalizeUrl(finalUrl);
  }

  function addManualCreator(formData) {
    const nextPlatforms = platforms.map((platform) => {
      if (platform.id !== formData.platformId) return platform;

      const creatorName = formData.creator.trim();
      const homepageUrl = normalizeUrl(formData.homepageUrl.trim());
      const hasUpdate = formData.title.trim() && formData.updateUrl.trim();
      const updates = hasUpdate
        ? [
            createUpdate(
              `${formData.platformId}-manual-update-${Date.now()}`,
              formData.time,
              formData.title.trim(),
              normalizeUrl(formData.updateUrl.trim())
            )
          ]
        : [];
      const existingCreator = platform.creators.find(
        (creator) => creator.homepageUrl === homepageUrl || creator.name === creatorName
      );

      if (existingCreator) {
        return {
          ...platform,
          connected: true,
          creators: platform.creators.map((creator) => {
            if (creator.id !== existingCreator.id) return creator;

            return {
              ...creator,
              selected: true,
              homepageUrl,
              updates: [...updates, ...creator.updates]
            };
          })
        };
      }

      return {
        ...platform,
        connected: true,
        creators: [
          createCreator(formData.platformId, creatorName, homepageUrl, `manual-${homepageUrl}`, updates),
          ...platform.creators
        ]
      };
    });

    updatePlatforms(nextPlatforms);
    setManualPlatformId(null);
  }

  function addRssSource(formData) {
    const nextPlatforms = platforms.map((platform) => {
      if (platform.id !== "rss") return platform;

      const sourceName = formData.creator.trim();
      const homepageUrl = normalizeUrl(formData.homepageUrl.trim());
      const update = createUpdate(
        `rss-update-${Date.now()}`,
        getCurrentTime(),
        `${sourceName} 最新文章`,
        homepageUrl
      );

      return {
        ...platform,
        connected: true,
        creators: [
          createCreator("rss", sourceName, homepageUrl, `rss-${homepageUrl}`, [update]),
          ...platform.creators
        ]
      };
    });

    updatePlatforms(nextPlatforms);
    setManualPlatformId(null);
  }

  function addSyncedCreators(platformId, names) {
    const nextPlatforms = platforms.map((platform) => {
      if (platform.id !== platformId) return platform;

      const existingNames = new Set(platform.creators.map((creator) => creator.name));
      const selectedCreators = names.map((name, index) => {
        const sourceId = `youtube-source-${index + 1}`;
        const homepageUrl = getYoutubeHomepage(name);

        return createCreator("youtube", name, homepageUrl, sourceId, [
          createUpdate(
            `${sourceId}-update-${Date.now()}`,
            getCurrentTime(),
            getMockUpdateTitle(name),
            homepageUrl
          )
        ]);
      });

      return {
        ...platform,
        connected: true,
        creators: [
          ...selectedCreators.filter((creator) => !existingNames.has(creator.name)),
          ...platform.creators.map((creator) => {
            if (!names.includes(creator.name)) return creator;

            const hasUnreadUpdate = creator.updates.some((update) => !update.read);
            return {
              ...creator,
              selected: true,
              updates: hasUnreadUpdate
                ? creator.updates
                : [
                    createUpdate(
                      `${creator.sourceId}-update-${Date.now()}`,
                      getCurrentTime(),
                      getMockUpdateTitle(creator.name),
                      creator.homepageUrl
                    ),
                    ...creator.updates
                  ]
            };
          })
        ]
      };
    });

    updatePlatforms(nextPlatforms);
    setConnectPlatformId(null);
  }

  function resetDemo() {
    updatePlatforms(initialPlatforms);
    setActivePlatformId(null);
    setManualPlatformId(null);
    setConnectPlatformId(null);
    setActiveTab("home");
  }

  function openPlatformAction(platform) {
    if (platform.id === "youtube") {
      setConnectPlatformId(platform.id);
      return;
    }

    setManualPlatformId(platform.id);
  }

  function exportData() {
    const payload = {
      app: "follow",
      version: "0.1",
      exportedAt: new Date().toISOString(),
      platforms
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "follow-backup.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  function importData(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!window.confirm("导入会覆盖当前 follow 数据，确定继续吗？")) {
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const importedPlatforms = Array.isArray(parsed) ? parsed : parsed.platforms;

        if (!Array.isArray(importedPlatforms)) {
          throw new Error("Invalid backup");
        }

        updatePlatforms(importedPlatforms);
        setActiveTab("home");
        setActivePlatformId(null);
      } catch {
        alert("导入失败，请确认文件是 follow 导出的 JSON 数据");
      } finally {
        event.target.value = "";
      }
    };
    reader.readAsText(file);
  }

  function clearData() {
    if (!window.confirm("确定清空 follow 数据并恢复初始状态吗？")) {
      return;
    }

    localStorage.removeItem(STORAGE_KEY);
    setPlatforms(initialPlatforms);
    setActiveTab("home");
    setActivePlatformId(null);
    setManualPlatformId(null);
    setConnectPlatformId(null);
  }

  return (
    <main className="page">
      <section className="phone-shell">
        <header className="app-header">
          <div>
            <h1 className="brand-word">follow</h1>
            <p>先关联平台，再选择要追更的博主</p>
          </div>

          <button
            className="add-heart"
            type="button"
            onClick={() => setManualPlatformId("rss")}
            aria-label="添加 RSS"
          >
            ♡
          </button>
        </header>

        {activePlatform && activeTab === "home" && (
          <PlatformDetail
            platform={activePlatform}
            onBack={() => setActivePlatformId(null)}
            onManualAdd={() => setManualPlatformId(activePlatform.id)}
            onOpenUpdate={openExternalLink}
          />
        )}

        {!activePlatform && activeTab === "home" && (
          <HomePage
            platforms={platforms}
            onConnect={openPlatformAction}
            onReset={resetDemo}
            onViewAll={(platformId) => setActivePlatformId(platformId)}
          />
        )}

        {activeTab === "sync" && <SyncPage />}

        {activeTab === "settings" && (
          <SettingsPage onExport={exportData} onImport={importData} onClear={clearData} />
        )}

        <nav className="tab-bar">
          <button
            className={`tab ${activeTab === "home" ? "active" : ""}`}
            type="button"
            onClick={openHome}
          >
            <span>⌂</span>
            首页
          </button>

          <button
            className={`tab ${activeTab === "sync" ? "active" : ""}`}
            type="button"
            onClick={() => {
              setActiveTab("sync");
              setActivePlatformId(null);
            }}
          >
            <span>⟳</span>
            同步
          </button>

          <button
            className={`tab ${activeTab === "settings" ? "active" : ""}`}
            type="button"
            onClick={() => {
              setActiveTab("settings");
              setActivePlatformId(null);
            }}
          >
            <span>⚙</span>
            设置
          </button>
        </nav>
      </section>

      {manualPlatform && (
        <ManualAddModal
          platform={manualPlatform}
          onClose={() => setManualPlatformId(null)}
          onAdd={manualPlatform.id === "rss" ? addRssSource : addManualCreator}
        />
      )}

      {connectPlatform && (
        <ConnectPlatformModal
          platform={connectPlatform}
          onClose={() => setConnectPlatformId(null)}
          onAdd={addSyncedCreators}
        />
      )}
    </main>
  );
}

function HomePage({ platforms, onConnect, onReset, onViewAll }) {
  return (
    <section className="overview">
      <div className="overview-head">
        <div>
          <h2>自动同步来源</h2>
          <p>先关联平台，再选择要追更的博主</p>
        </div>

        <button type="button" onClick={onReset}>
          重置
        </button>
      </div>

      <div className="platform-list">
        {platforms.map((platform) => (
          <PlatformCard
            key={platform.id}
            platform={platform}
            onConnect={() => onConnect(platform)}
            onViewAll={() => onViewAll(platform.id)}
          />
        ))}
      </div>
    </section>
  );
}

function SyncPage() {
  return (
    <section className="simple-page">
      <span className="blue-oval">同步</span>
      <h2>同步中心开发中</h2>
      <p>这里后续会集中显示账号连接状态、同步记录和手动刷新入口。</p>
    </section>
  );
}

function SettingsPage({ onExport, onImport, onClear }) {
  return (
    <section className="settings-page">
      <div className="settings-title">
        <span className="blue-oval">设置</span>
      </div>

      <section className="settings-card">
        <h2>数据管理</h2>

        <div className="settings-actions">
          <button type="button" onClick={onExport}>
            导出数据
          </button>

          <label className="import-button">
            导入数据
            <input type="file" accept="application/json,.json" onChange={onImport} />
          </label>

          <button className="danger-button" type="button" onClick={onClear}>
            清空数据
          </button>
        </div>
      </section>

      <section className="settings-card">
        <h2>关于</h2>
        <p>follow v0.1</p>
        <p>个人追更小工具</p>
        <p>当前版本为 PWA 原型</p>
      </section>
    </section>
  );
}

function PlatformCard({ platform, onConnect, onViewAll }) {
  const unreadCreators = getUnreadCreators(platform);
  const previewCreators = unreadCreators.slice(0, 2);
  const restCount = unreadCreators.length - previewCreators.length;
  const hasUnread = unreadCreators.length > 0;
  const isConnected = platform.connected || platform.creators.length > 0;
  const statusText = getStatusText({ ...platform, connected: isConnected }, unreadCreators);

  return (
    <article className="platform-card">
      <div className="platform-card-head">
        <div className="platform-title">
          <span className="blue-oval">{platform.name}</span>
          <span className="count-text">{statusText}</span>
        </div>

        {!isConnected ? (
          <button className="view-all" type="button" onClick={onConnect}>
            {getActionText(platform)}
          </button>
        ) : (
          <button className="view-all" type="button" onClick={onViewAll}>
            查看全部 →
          </button>
        )}
      </div>

      {isConnected && hasUnread && (
        <div className="creator-list">
          {previewCreators.map((creator) => (
            <CreatorRow key={creator.id} creator={creator} update={creator.unreadUpdates[0]} />
          ))}

          {restCount > 0 && (
            <button className="more-line" type="button" onClick={onViewAll}>
              还有 {restCount} {platform.id === "rss" ? "个订阅源" : "位"}更新⌄
            </button>
          )}
        </div>
      )}

      {isConnected && !hasUnread && <p className="platform-note">{getConnectedNote(platform)}</p>}
    </article>
  );
}

function CreatorRow({ creator, update }) {
  return (
    <div className="creator-row">
      <Avatar text={creator.avatar} />

      <div className="creator-info">
        <div>
          <strong>{creator.name}</strong>
          <span>{update.time} 更新</span>
        </div>

        <p>{update.title}</p>
      </div>
    </div>
  );
}

function PlatformDetail({ platform, onBack, onManualAdd, onOpenUpdate }) {
  const unreadCreators = getUnreadCreators(platform);
  const readUpdates = getAllReadUpdates(platform);
  const statusText = getStatusText({ ...platform, connected: true }, unreadCreators);

  return (
    <section className="detail-page">
      <div className="detail-head">
        <button className="back-link" type="button" onClick={onBack}>
          ← 返回首页
        </button>

        <button className="detail-add-button" type="button" onClick={onManualAdd} aria-label={`添加${platform.name}博主`}>
          ＋
        </button>
      </div>

      <div className="detail-title">
        <span className="blue-oval large">{platform.name}</span>
        <p>{statusText}</p>
      </div>

      {unreadCreators.length > 0 ? (
        <div className="detail-list">
          {unreadCreators.flatMap((creator) =>
            creator.unreadUpdates.map((update) => (
              <article className="detail-card" key={`${creator.id}-${update.id}`}>
                <CreatorRow creator={creator} update={update} />

                <button
                  className="open-content"
                  type="button"
                  onClick={() => onOpenUpdate({ platform, creator, update })}
                >
                  打开内容 →
                </button>
              </article>
            ))
          )}
        </div>
      ) : (
        <EmptyState />
      )}

      {readUpdates.length > 0 && (
        <section className="read-area">
          <span className="gray-oval">已读更新</span>

          {readUpdates.map((update) => (
            <div className="read-item" key={update.id}>
              <strong>{update.creatorName}</strong>
              <p>{update.title}</p>
            </div>
          ))}
        </section>
      )}
    </section>
  );
}

function ConnectPlatformModal({ platform, onClose, onAdd }) {
  const [selectedNames, setSelectedNames] = useState(youtubeMockCreators.slice(0, 3));

  function toggleCreator(name) {
    setSelectedNames((current) => {
      if (current.includes(name)) {
        return current.filter((item) => item !== name);
      }

      return [...current, name];
    });
  }

  function handleSubmit(event) {
    event.preventDefault();

    if (selectedNames.length === 0) {
      alert("至少选择一个频道加入 follow");
      return;
    }

    onAdd(platform.id, selectedNames);
  }

  return (
    <div className="modal-mask">
      <form className="modal-card" onSubmit={handleSubmit}>
        <div className="modal-head">
          <h2>关联 {platform.name}</h2>

          <button type="button" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="mock-notice">
          <strong>当前为模拟同步流程</strong>
          <p>真实 YouTube 授权将在后续接入。</p>
          <p>现在先用示例订阅频道测试体验。</p>
        </div>

        <ol className="connect-steps">
          <li>正在请求授权</li>
          <li>模拟读取订阅频道</li>
          <li>发现 6 个订阅频道</li>
        </ol>

        <div className="channel-list">
          {youtubeMockCreators.map((name, index) => (
            <label className="channel-row" key={name}>
              <input
                type="checkbox"
                checked={selectedNames.includes(name)}
                onChange={() => toggleCreator(name)}
              />
              <span>{name}</span>
              <small>{index < 3 ? "默认加入" : "可选"}</small>
            </label>
          ))}
        </div>

        <button className="submit-button" type="submit">
          加入 follow
        </button>
      </form>
    </div>
  );
}

function ManualAddModal({ platform, onClose, onAdd }) {
  const isRss = platform.id === "rss";
  const [form, setForm] = useState({
    platformId: platform.id,
    creator: "",
    homepageUrl: "",
    title: "",
    updateUrl: "",
    time: getCurrentTime()
  });

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();

    if (!form.creator.trim() || !form.homepageUrl.trim()) {
      alert(isRss ? "请填写订阅源名称和 RSS 链接" : "请填写博主名和博主主页链接");
      return;
    }

    if (!isRss && Boolean(form.title.trim()) !== Boolean(form.updateUrl.trim())) {
      alert("最新内容标题和最新内容链接需要一起填写，或都留空");
      return;
    }

    onAdd({
      platformId: form.platformId,
      creator: form.creator,
      homepageUrl: form.homepageUrl,
      title: form.title,
      updateUrl: form.updateUrl,
      time: form.time || getCurrentTime()
    });
  }

  return (
    <div className="modal-mask">
      <form className="modal-card" onSubmit={handleSubmit}>
        <div className="modal-head">
          <h2>{isRss ? "添加 RSS 订阅源" : `添加 ${platform.name} 博主`}</h2>

          <button type="button" onClick={onClose}>
            ×
          </button>
        </div>

        <label>
          {isRss ? "订阅源名称" : "博主名"}
          <input
            name="creator"
            value={form.creator}
            onChange={handleChange}
            placeholder={isRss ? "例如：Design Feed" : "例如：瑞英"}
          />
        </label>

        <label>
          {isRss ? "RSS 链接" : platform.id === "youtube" ? "频道主页链接" : "博主主页链接"}
          <input
            name="homepageUrl"
            value={form.homepageUrl}
            onChange={handleChange}
            placeholder="https://..."
          />
        </label>

        {!isRss && (
          <>
            <label>
              最新内容标题，可选
              <input
                name="title"
                value={form.title}
                onChange={handleChange}
                placeholder="例如：周末独居日常"
              />
            </label>

            <label>
              最新内容链接，可选
              <input
                name="updateUrl"
                value={form.updateUrl}
                onChange={handleChange}
                placeholder="https://..."
              />
            </label>

            <label>
              更新时间
              <input
                name="time"
                value={form.time}
                onChange={handleChange}
                placeholder="10:32"
              />
            </label>
          </>
        )}

        <button className="submit-button" type="submit">
          加入 follow
        </button>
      </form>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <span className="blue-oval">done</span>
      <h3>暂无新更新</h3>
      <p>已配置，等待下一次更新。</p>
    </div>
  );
}

function Avatar({ text }) {
  return <span className="avatar">{text}</span>;
}
