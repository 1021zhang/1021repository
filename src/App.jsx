import { useState } from "react";

const STORAGE_KEY = "follow_blue_oval_app_v1";
const HOME_PLATFORM_IDS = ["youtube", "xiaohongshu", "weibo", "instagram"];

const initialPlatforms = [
  { id: "youtube", name: "YouTube", syncType: "manual", homepageUrl: "https://www.youtube.com", connected: false, creators: [] },
  { id: "xiaohongshu", name: "小红书", syncType: "manual", homepageUrl: "https://www.xiaohongshu.com", connected: false, creators: [] },
  { id: "weibo", name: "微博", syncType: "manual", homepageUrl: "https://weibo.com", connected: false, creators: [] },
  { id: "instagram", name: "Instagram", syncType: "manual", homepageUrl: "https://www.instagram.com", connected: false, creators: [] },
  { id: "rss", name: "RSS", syncType: "rss", homepageUrl: "", connected: false, creators: [] }
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
  return { id, title, url, time, read };
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

  if (!Array.isArray(platform.updates)) return [];

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

function loadPlatforms() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? normalizePlatforms(JSON.parse(saved)) : initialPlatforms;
  } catch {
    return initialPlatforms;
  }
}

function savePlatforms(platforms) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(platforms));
}

function normalizeExternalUrl(url) {
  if (!url) return "";
  const trimmedUrl = String(url).trim();
  const lowerUrl = trimmedUrl.toLowerCase();
  if (
    trimmedUrl === "" ||
    trimmedUrl === "#" ||
    lowerUrl === "about:blank" ||
    lowerUrl === "undefined" ||
    lowerUrl === "null"
  ) {
    return "";
  }
  if (lowerUrl.startsWith("http://") || lowerUrl.startsWith("https://")) return trimmedUrl;
  return `https://${trimmedUrl}`;
}

function isMockOrEmptyUrl(url) {
  return normalizeExternalUrl(url) === "";
}

function navigateExternal(finalUrl) {
  try {
    window.location.assign(finalUrl);
  } catch {
    const link = document.createElement("a");
    link.href = finalUrl;
    link.rel = "noreferrer";
    link.target = "_self";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
}

function getCurrentTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
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

function getReadUpdates(platform) {
  return platform.creators.flatMap((creator) =>
    creator.updates
      .filter((update) => update.read)
      .map((update) => ({ ...update, creatorName: creator.name }))
  );
}

function getStatusText(platform, unreadCreators) {
  const creatorCount = platform.creators.filter((creator) => creator.selected !== false).length;

  if (creatorCount === 0) {
    if (platform.id === "youtube") return "还没添加频道";
    return "还没添加博主";
  }

  if (unreadCreators.length > 0) {
    if (platform.id === "rss") return `${unreadCreators.length} 个订阅源更新`;
    return `${unreadCreators.length} 位博主更新`;
  }

  if (platform.id === "rss") return `已添加 ${creatorCount} 个订阅源，暂无新更新`;
  return `已添加 ${creatorCount} 位博主，暂无新更新`;
}

function getActionText(platform) {
  if (platform.id === "youtube") return "添加 YouTube 频道";
  if (platform.id === "xiaohongshu") return "添加小红书博主";
  if (platform.id === "weibo") return "添加微博博主";
  if (platform.id === "instagram") return "添加 Instagram 博主";
  return "添加 RSS";
}

function getConnectedNote(platform) {
  if (platform.id === "rss") return "等待下一次同步";
  return "等待下一次更新";
}

function getPlatformSupplementText(platform, creatorCount) {
  if (creatorCount > 0) return getConnectedNote(platform);
  if (platform.id === "youtube") return "先添加频道，有更新会显示在这里";
  return "先添加博主，有更新会显示在这里";
}

function getHomePlatforms(platforms) {
  return HOME_PLATFORM_IDS.map((platformId) => platforms.find((platform) => platform.id === platformId)).filter(Boolean);
}

function getManualModalTitle(platform) {
  if (platform.id === "rss") return "添加 RSS 订阅源";
  if (platform.id === "youtube") return "添加 YouTube 频道";
  return `添加 ${platform.name} 博主`;
}

function getHomepageLabel(platform) {
  if (platform.id === "rss") return "RSS 链接";
  if (platform.id === "youtube") return "频道主页链接";
  if (platform.id === "instagram") return "Instagram 主页链接";
  return "主页链接";
}

function getCreatorLabel(platform) {
  if (platform.id === "rss") return "订阅源名称";
  if (platform.id === "youtube") return "频道名";
  return "博主名";
}

function getCreatorPlaceholder(platform) {
  if (platform.id === "rss") return "例如：Design Feed";
  if (platform.id === "youtube") return "例如：MKBHD";
  if (platform.id === "instagram") return "例如：design";
  return "例如：瑞英";
}

export default function App() {
  const [platforms, setPlatforms] = useState(loadPlatforms);
  const [activePlatformId, setActivePlatformId] = useState(null);
  const [manualPlatformId, setManualPlatformId] = useState(null);
  const [showAddChoice, setShowAddChoice] = useState(false);
  const [activeTab, setActiveTab] = useState("home");

  const activePlatform = platforms.find((platform) => platform.id === activePlatformId);
  const manualPlatform = platforms.find((platform) => platform.id === manualPlatformId);

  function updatePlatforms(nextPlatforms) {
    const normalizedPlatforms = normalizePlatforms(nextPlatforms);
    setPlatforms(normalizedPlatforms);
    savePlatforms(normalizedPlatforms);
  }

  function openHome() {
    setActiveTab("home");
    setActivePlatformId(null);
    setShowAddChoice(false);
  }

  function markUpdateAsRead(platformId, creatorId, updateId) {
    updatePlatforms(
      platforms.map((platform) => {
        if (platform.id !== platformId) return platform;

        return {
          ...platform,
          creators: platform.creators.map((creator) => {
            if (creator.id !== creatorId) return creator;

            return {
              ...creator,
              updates: creator.updates.map((update) =>
                update.id === updateId ? { ...update, read: true } : update
              )
            };
          })
        };
      })
    );
  }

  function openExternalLink({ platform, creator, update }) {
    const finalUrl = normalizeExternalUrl(update?.url || creator?.homepageUrl || platform?.homepageUrl);

    if (!finalUrl) {
      alert("当前是模拟内容，暂无真实链接。你可以手动添加真实链接。");
      return;
    }

    if (update?.id && creator?.id && platform?.id) {
      markUpdateAsRead(platform.id, creator.id, update.id);
    }

    navigateExternal(finalUrl);
  }

  function openCreatorHomepage(platform, update) {
    const creator = platform.creators.find((item) => item.name === update.creatorName);
    const finalUrl = normalizeExternalUrl(creator?.homepageUrl || update.url);

    if (!finalUrl) {
      alert("当前没有可打开的主页链接");
      return;
    }

    navigateExternal(finalUrl);
  }

  function openFollowedCreatorHomepage(platform, creator) {
    const finalUrl = normalizeExternalUrl(creator?.homepageUrl);

    if (import.meta.env.DEV) {
      console.log("follow external homepage", {
        platformName: platform?.name,
        creatorName: creator?.name,
        homepageUrl: creator?.homepageUrl,
        normalizedUrl: finalUrl
      });
    }

    if (!finalUrl) {
      alert("当前没有可打开的主页链接");
      return;
    }

    navigateExternal(finalUrl);
  }

  function removeCreator(platformId, creator) {
    if (!window.confirm(`确定不再关注「${creator.name}」吗？`)) return;

    updatePlatforms(
      platforms.map((platform) => {
        if (platform.id !== platformId) return platform;

        return {
          ...platform,
          connected: platform.creators.length > 1,
          creators: platform.creators.filter((item) => item.id !== creator.id)
        };
      })
    );
  }

  function addManualCreator(formData) {
    updatePlatforms(
      platforms.map((platform) => {
        if (platform.id !== formData.platformId) return platform;

        const creatorName = formData.creator.trim();
        const homepageUrl = normalizeExternalUrl(formData.homepageUrl);
        const updateTitle = formData.title.trim();
        const updateUrl = formData.updateUrl.trim();
        const hasUpdate = updateTitle || updateUrl;
        const updates = hasUpdate
          ? [
              createUpdate(
                `${formData.platformId}-manual-update-${Date.now()}`,
                formData.time,
                updateTitle || `${creatorName} 最新内容`,
                updateUrl ? normalizeExternalUrl(updateUrl) : ""
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
            creators: platform.creators.map((creator) =>
              creator.id === existingCreator.id
                ? { ...creator, selected: true, homepageUrl, updates: [...updates, ...creator.updates] }
                : creator
            )
          };
        }

        return {
          ...platform,
          connected: true,
          creators: [
            createCreator(formData.platformId, creatorName, homepageUrl, `manual-${Date.now()}`, updates),
            ...platform.creators
          ]
        };
      })
    );

    setManualPlatformId(null);
  }

  function addRssSource(formData) {
    updatePlatforms(
      platforms.map((platform) => {
        if (platform.id !== "rss") return platform;

        const sourceName = formData.creator.trim();
        const homepageUrl = normalizeExternalUrl(formData.homepageUrl);
        const update = createUpdate(`rss-update-${Date.now()}`, getCurrentTime(), `${sourceName} 最新文章`, homepageUrl);

        return {
          ...platform,
          connected: true,
          creators: [
            createCreator("rss", sourceName, homepageUrl, `rss-${Date.now()}`, [update]),
            ...platform.creators
          ]
        };
      })
    );

    setManualPlatformId(null);
  }

  function resetDemo() {
    updatePlatforms(initialPlatforms);
    setActivePlatformId(null);
    setManualPlatformId(null);
    setShowAddChoice(false);
    setActiveTab("home");
  }

  function openPlatformAction(platform) {
    setManualPlatformId(platform.id);
  }

  function openAddChoice(platformId) {
    setShowAddChoice(false);
    setManualPlatformId(platformId);
  }

  function exportData() {
    const blob = new Blob(
      [JSON.stringify({ app: "follow", version: "0.1", exportedAt: new Date().toISOString(), platforms }, null, 2)],
      { type: "application/json" }
    );
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
        if (!Array.isArray(importedPlatforms)) throw new Error("Invalid backup");
        updatePlatforms(importedPlatforms);
        openHome();
      } catch {
        alert("导入失败，请确认文件是 follow 导出的 JSON 数据");
      } finally {
        event.target.value = "";
      }
    };
    reader.readAsText(file);
  }

  function clearData() {
    if (!window.confirm("确定清空 follow 数据并恢复初始状态吗？")) return;
    localStorage.removeItem(STORAGE_KEY);
    setPlatforms(initialPlatforms);
    openHome();
  }

  return (
    <main className="page">
      <section className="phone-shell">
        <header className="app-header">
          <div>
            <h1 className="brand-word">follow</h1>
            <p>关注的人，有更新了</p>
          </div>

          {!activePlatform && activeTab === "home" && (
            <button
              className="top-add-button"
              type="button"
              onClick={() => setShowAddChoice(true)}
              aria-label="添加到 follow"
            >
              ＋
            </button>
          )}
        </header>

        {activePlatform && activeTab === "home" && (
          <PlatformDetail
            platform={activePlatform}
            onBack={() => setActivePlatformId(null)}
            onManualAdd={() => setManualPlatformId(activePlatform.id)}
            onOpenUpdate={openExternalLink}
            onOpenHomepage={openCreatorHomepage}
            onOpenFollowedCreator={openFollowedCreatorHomepage}
            onRemoveCreator={removeCreator}
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
        {activeTab === "settings" && <SettingsPage onExport={exportData} onImport={importData} onClear={clearData} />}

        <nav className="tab-bar">
          <button className={`tab ${activeTab === "home" ? "active" : ""}`} type="button" onClick={openHome}>
            <TabIcon name="home" />
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
            <TabIcon name="sync" />
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
            <TabIcon name="settings" />
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
      {showAddChoice && <AddChoiceModal onClose={() => setShowAddChoice(false)} onChoose={openAddChoice} />}
    </main>
  );
}

function HomePage({ platforms, onConnect, onReset, onViewAll }) {
  const homePlatforms = getHomePlatforms(platforms);

  return (
    <section className="overview">
      <div className="overview-head">
        <div>
          <h2>我的追更</h2>
          <p>先添加想追的博主，有更新就会显示在这里</p>
        </div>
        <button type="button" onClick={onReset}>重置</button>
      </div>

      <div className="platform-list">
        {homePlatforms.map((platform) => (
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

function PlatformCard({ platform, onConnect, onViewAll }) {
  const unreadCreators = getUnreadCreators(platform);
  const previewCreators = unreadCreators.slice(0, 2);
  const restCount = unreadCreators.length - previewCreators.length;
  const creatorCount = platform.creators.filter((creator) => creator.selected !== false).length;
  const statusText = getStatusText(platform, unreadCreators);
  const supplementText = getPlatformSupplementText(platform, creatorCount);

  return (
    <article className="platform-card">
      <div className="platform-card-head">
        <div className="platform-title">
          <span className="blue-oval">{platform.name}</span>
        </div>

        {creatorCount === 0 ? (
          <button className="view-all" type="button" onClick={onConnect}>{getActionText(platform)}</button>
        ) : (
          <button className="view-all" type="button" onClick={onViewAll}>查看全部 →</button>
        )}
      </div>

      <p className="count-text platform-status">{statusText}</p>
      <p className="platform-note">{supplementText}</p>

      {unreadCreators.length > 0 && (
        <div className="creator-list">
          {previewCreators.map((creator) => (
            <CreatorRow key={creator.id} creator={creator} update={creator.unreadUpdates[0]} />
          ))}
          {restCount > 0 && (
            <button className="more-line" type="button" onClick={onViewAll}>还有 {restCount} 位更新⌄</button>
          )}
        </div>
      )}
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

function PlatformDetail({
  platform,
  onBack,
  onManualAdd,
  onOpenUpdate,
  onOpenHomepage,
  onOpenFollowedCreator,
  onRemoveCreator
}) {
  const [showReadUpdates, setShowReadUpdates] = useState(false);
  const unreadCreators = getUnreadCreators(platform);
  const readUpdates = getReadUpdates(platform);
  const followedCreators = platform.creators.filter((creator) => creator.selected !== false);
  const statusText = getStatusText(platform, unreadCreators);

  return (
    <section className="detail-page">
      <div className="detail-head">
        <button className="back-link" type="button" onClick={onBack}>← 返回首页</button>
        <button className="detail-add-button" type="button" onClick={onManualAdd} aria-label={`添加${platform.name}`}>＋</button>
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
                <button className="open-content" type="button" onClick={() => onOpenUpdate({ platform, creator, update })}>进入主页 →</button>
              </article>
            ))
          )}
        </div>
      ) : (
        <EmptyState />
      )}

      {platform.creators.length > 0 && (
        <FollowedCreatorsSection
          creators={followedCreators}
          onOpenCreator={(creator) => onOpenFollowedCreator(platform, creator)}
          onRemoveCreator={(creator) => onRemoveCreator(platform.id, creator)}
        />
      )}

      {readUpdates.length > 0 && (
        <section className="read-area">
          <button className="read-toggle" type="button" onClick={() => setShowReadUpdates((current) => !current)}>
            已读更新 {readUpdates.length} 条 {showReadUpdates ? "∧" : "∨"}
          </button>

          {showReadUpdates && (
            <div className="read-list">
              {readUpdates.map((update) => (
                <div className="read-item" key={`${update.creatorName}-${update.id}`}>
                  <div>
                    <strong>{update.creatorName}</strong>
                    <p>{update.title}</p>
                  </div>
                  <button type="button" onClick={() => onOpenHomepage(platform, update)}>进入主页 →</button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </section>
  );
}

function FollowedCreatorsSection({ creators, onOpenCreator, onRemoveCreator }) {
  return (
    <section className="followed-area">
      <h3>已关注博主 {creators.length} 位</h3>
      <div className="followed-list">
        {creators.map((creator) => (
          <div className="followed-item" key={creator.id}>
            <strong>{creator.name}</strong>
            <div className="followed-actions">
              {isMockOrEmptyUrl(creator.homepageUrl) ? (
                <span>暂无主页链接</span>
              ) : (
                <button type="button" onClick={() => onOpenCreator(creator)}>进入主页 →</button>
              )}
              <button className="remove-creator-button" type="button" onClick={() => onRemoveCreator(creator)}>
                移除
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TabIcon({ name }) {
  if (name === "home") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 10.5 12 4l8 6.5" />
        <path d="M6.5 10v9h11v-9" />
        <path d="M10 19v-5h4v5" />
      </svg>
    );
  }

  if (name === "sync") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 6v5h-5" />
        <path d="M4 18v-5h5" />
        <path d="M18.1 9A7 7 0 0 0 6.7 6.8L4 9.4" />
        <path d="M5.9 15A7 7 0 0 0 17.3 17.2L20 14.6" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z" />
      <path d="M19 12a7.8 7.8 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.8-1L14.4 3h-4.8l-.3 3.1a7 7 0 0 0-1.8 1l-2.4-1-2 3.4 2 1.5a7.8 7.8 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 1.8 1l.3 3.1h4.8l.3-3.1a7 7 0 0 0 1.8-1l2.4 1 2-3.4-2-1.5c.1-.3.1-.7.1-1Z" />
    </svg>
  );
}

function AddChoiceModal({ onClose, onChoose }) {
  const options = [
    { id: "youtube", label: "添加 YouTube 频道" },
    { id: "xiaohongshu", label: "添加小红书博主" },
    { id: "weibo", label: "添加微博博主" },
    { id: "instagram", label: "添加 Instagram 博主" },
    { id: "rss", label: "高级：添加 RSS 订阅源" }
  ];

  return (
    <div className="modal-mask">
      <section className="modal-card">
        <div className="modal-head">
          <h2>添加到 follow</h2>
          <button type="button" onClick={onClose}>×</button>
        </div>
        <div className="add-choice-list">
          {options.map((option) => (
            <button key={option.id} type="button" onClick={() => onChoose(option.id)}>{option.label}</button>
          ))}
        </div>
      </section>
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
    setForm((current) => ({ ...current, [name]: value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!form.creator.trim() || !form.homepageUrl.trim()) {
      alert(`请填写${getCreatorLabel(platform)}和${getHomepageLabel(platform)}`);
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
          <h2>{getManualModalTitle(platform)}</h2>
          <button type="button" onClick={onClose}>×</button>
        </div>

        <label>
          {getCreatorLabel(platform)}
          <input name="creator" value={form.creator} onChange={handleChange} placeholder={getCreatorPlaceholder(platform)} />
        </label>

        <label>
          {getHomepageLabel(platform)}
          <input name="homepageUrl" value={form.homepageUrl} onChange={handleChange} placeholder="https://..." />
        </label>

        {!isRss && (
          <>
            <label>
              最新内容标题，可选
              <input name="title" value={form.title} onChange={handleChange} placeholder="例如：周末独居日常" />
            </label>
            <label>
              最新内容链接，可选
              <input name="updateUrl" value={form.updateUrl} onChange={handleChange} placeholder="https://..." />
            </label>
            <label>
              更新时间
              <input name="time" value={form.time} onChange={handleChange} placeholder="10:32" />
            </label>
          </>
        )}

        <button className="submit-button" type="submit">加入 follow</button>
      </form>
    </div>
  );
}

function SettingsPage({ onExport, onImport, onClear }) {
  return (
    <section className="settings-page">
      <div className="settings-title"><span className="blue-oval">设置</span></div>
      <section className="settings-card">
        <h2>数据管理</h2>
        <div className="settings-actions">
          <button type="button" onClick={onExport}>导出数据</button>
          <label className="import-button">导入数据<input type="file" accept="application/json,.json" onChange={onImport} /></label>
          <button className="danger-button" type="button" onClick={onClear}>清空数据</button>
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

function SyncPage() {
  return (
    <section className="simple-page">
      <span className="blue-oval">同步</span>
      <h2>同步中心开发中</h2>
      <p>这里后续会集中显示账号连接状态、同步记录和手动刷新入口。</p>
    </section>
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
