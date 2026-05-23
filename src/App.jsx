import { useState } from "react";

const STORAGE_KEY = "follow_blue_oval_app_v1";

const mockSourceCreators = {
  youtube: [
    "Peter McKinnon",
    "Sara Dietschy",
    "MKBHD",
    "The Futur",
    "BestDressed",
    "Vogue"
  ],
  twitch: [
    "shroud",
    "pokimane",
    "LIRIK",
    "tarik",
    "QuarterJade",
    "ludwig"
  ]
};

const initialPlatforms = [
  {
    id: "youtube",
    name: "YouTube",
    syncType: "auto",
    connected: false,
    creators: []
  },
  {
    id: "twitch",
    name: "Twitch",
    syncType: "auto",
    connected: false,
    creators: []
  },
  {
    id: "rss",
    name: "RSS",
    syncType: "rss",
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
  const platformMap = new Map(platforms.map((platform) => [platform.id, platform]));

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

function getCreatorHomepage(platformId, name) {
  const slug = name.toLowerCase().replaceAll(" ", "");
  if (platformId === "youtube") return `https://www.youtube.com/@${slug}`;
  if (platformId === "twitch") return `https://www.twitch.tv/${slug}`;
  return `https://${slug}.example.com/feed`;
}

function getMockUpdateTitle(platformId, name) {
  const titles = {
    youtube: {
      "Peter McKinnon": "My Camera Bag 2026",
      "Sara Dietschy": "Tech Desk Setup",
      MKBHD: "What’s New This Week",
      "The Futur": "Design systems that actually scale",
      BestDressed: "Closet refresh before summer",
      Vogue: "Inside a quiet morning routine"
    },
    twitch: {
      shroud: "今晚排位直播回放",
      pokimane: "Just Chatting 新片段",
      LIRIK: "新游戏首播",
      tarik: "赛后复盘直播",
      QuarterJade: "周末联机局",
      ludwig: "直播剪辑更新"
    }
  };

  return titles[platformId]?.[name] || `${name} 发布了新内容`;
}

function getStatusText(platform, unreadCreators) {
  if (platform.id === "rss") {
    if (!platform.connected) return "可添加订阅源";
    if (unreadCreators.length > 0) return `${unreadCreators.length} 个订阅源更新`;
    return "暂无新更新";
  }

  if (!platform.connected) return "可自动同步";
  if (unreadCreators.length > 0) {
    const unit = platform.id === "twitch" ? "位主播更新" : "位博主更新";
    return `${unreadCreators.length} ${unit}`;
  }

  return "暂无新更新";
}

export default function App() {
  const [platforms, setPlatforms] = useState(loadPlatforms);
  const [activePlatformId, setActivePlatformId] = useState(null);
  const [manualPlatformId, setManualPlatformId] = useState(null);
  const [connectPlatformId, setConnectPlatformId] = useState(null);

  const activePlatform = platforms.find((platform) => platform.id === activePlatformId);
  const connectPlatform = platforms.find((platform) => platform.id === connectPlatformId);
  const manualPlatform = platforms.find((platform) => platform.id === manualPlatformId);

  function updatePlatforms(nextPlatforms) {
    setPlatforms(nextPlatforms);
    savePlatforms(nextPlatforms);
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

  function openUpdate(platformId, creator, update) {
    window.open(update.url, "_blank", "noopener,noreferrer");
    markUpdateAsRead(platformId, creator.id, update.id);
  }

  function addManualUpdate(formData) {
    const nextPlatforms = platforms.map((platform) => {
      if (platform.id !== formData.platformId) return platform;

      const creatorName = formData.creator.trim();
      const homepageUrl = normalizeUrl(formData.homepageUrl.trim());
      const sourceId = `manual-${homepageUrl}`;
      const update = createUpdate(
        `${formData.platformId}-manual-update-${Date.now()}`,
        formData.time,
        formData.title || `${creatorName} 有一条新更新`,
        normalizeUrl(formData.updateUrl || homepageUrl)
      );
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
              updates: [update, ...creator.updates]
            };
          })
        };
      }

      return {
        ...platform,
        connected: true,
        creators: [
          createCreator(formData.platformId, creatorName, homepageUrl, sourceId, [update]),
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

      const existingSourceIds = new Set(platform.creators.map((creator) => creator.sourceId));
      const existingNames = new Set(platform.creators.map((creator) => creator.name));
      const syncedCreators = names.map((name, index) => {
        const sourceId = `${platformId}-source-${index + 1}`;
        const homepageUrl = getCreatorHomepage(platformId, name);

        return createCreator(platformId, name, homepageUrl, sourceId, [
          createUpdate(
            `${sourceId}-update-${Date.now()}`,
            getCurrentTime(),
            getMockUpdateTitle(platformId, name),
            homepageUrl
          )
        ]);
      });

      return {
        ...platform,
        connected: true,
        creators: [
          ...syncedCreators.filter(
            (creator) => !existingSourceIds.has(creator.sourceId) && !existingNames.has(creator.name)
          ),
          ...platform.creators.map((creator) => {
            if (!names.includes(creator.name)) return creator;

            return {
              ...creator,
              selected: true
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
  }

  function openPlatformAction(platform) {
    if (platform.id === "rss") {
      setManualPlatformId("rss");
      return;
    }

    setConnectPlatformId(platform.id);
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

        {!activePlatform && (
          <>
            <section className="overview">
              <div className="overview-head">
                <div>
                  <h2>自动同步来源</h2>
                  <p>先关联平台，再选择要追更的博主</p>
                </div>

                <button type="button" onClick={resetDemo}>
                  重置
                </button>
              </div>

              <div className="platform-list">
                {platforms.map((platform) => (
                  <PlatformCard
                    key={platform.id}
                    platform={platform}
                    onConnect={() => openPlatformAction(platform)}
                    onViewAll={() => setActivePlatformId(platform.id)}
                  />
                ))}
              </div>
            </section>
          </>
        )}

        {activePlatform && (
          <PlatformDetail
            platform={activePlatform}
            onBack={() => setActivePlatformId(null)}
            onOpenUpdate={openUpdate}
          />
        )}

        <nav className="tab-bar">
          <button
            className={`tab ${!activePlatform ? "active" : ""}`}
            type="button"
            onClick={() => setActivePlatformId(null)}
          >
            <span>⌂</span>
            首页
          </button>

          <button className="tab" type="button" aria-disabled="true">
            <span>⟳</span>
            同步
          </button>

          <button className="tab" type="button" aria-disabled="true">
            <span>⚙</span>
            设置
          </button>
        </nav>
      </section>

      {manualPlatform && (
        <AddUpdateModal
          platforms={platforms}
          initialPlatformId={manualPlatform.id}
          onClose={() => setManualPlatformId(null)}
          onAdd={addManualUpdate}
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
            {platform.id === "rss" ? "添加 RSS" : `关联 ${platform.name}`}
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

      {isConnected && !hasUnread && (
        <p className="platform-note">已关联，等待下一次同步</p>
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

function PlatformDetail({ platform, onBack, onOpenUpdate }) {
  const unreadCreators = getUnreadCreators(platform);
  const readUpdates = getAllReadUpdates(platform);
  const statusText = getStatusText({ ...platform, connected: true }, unreadCreators);

  return (
    <section className="detail-page">
      <button className="back-link" type="button" onClick={onBack}>
        ← 返回首页
      </button>

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
                  onClick={() => onOpenUpdate(platform.id, creator, update)}
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
  const creatorNames = mockSourceCreators[platform.id] || [];
  const defaultCount = platform.id === "twitch" ? 2 : 3;
  const [selectedNames, setSelectedNames] = useState(creatorNames.slice(0, defaultCount));
  const noun = platform.id === "twitch" ? "关注主播" : "订阅频道";

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
      alert(`至少选择一个${platform.id === "twitch" ? "主播" : "频道"}加入 follow`);
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

        <ol className="connect-steps">
          <li>正在请求授权</li>
          <li>正在读取你的{noun}</li>
          <li>发现 {creatorNames.length} 个{noun}</li>
        </ol>

        <div className="channel-list">
          {creatorNames.map((name, index) => (
            <label className="channel-row" key={name}>
              <input
                type="checkbox"
                checked={selectedNames.includes(name)}
                onChange={() => toggleCreator(name)}
              />
              <span>{name}</span>
              <small>{index < defaultCount ? "默认加入" : "可选"}</small>
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

function AddUpdateModal({ platforms, initialPlatformId, onClose, onAdd }) {
  const isRss = initialPlatformId === "rss";
  const [form, setForm] = useState({
    platformId: initialPlatformId,
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

    if (
      !form.platformId ||
      !form.creator.trim() ||
      !form.homepageUrl.trim() ||
      (!isRss && (!form.title.trim() || !form.updateUrl.trim()))
    ) {
      alert(isRss ? "请填写订阅源名称和 RSS 链接" : "请把平台、主页、更新标题和内容链接填写完整");
      return;
    }

    onAdd({
      platformId: form.platformId,
      creator: form.creator.trim(),
      homepageUrl: form.homepageUrl.trim(),
      title: isRss ? `${form.creator.trim()} 最新文章` : form.title.trim(),
      updateUrl: isRss ? form.homepageUrl.trim() : form.updateUrl.trim(),
      time: form.time.trim() || getCurrentTime()
    });
  }

  return (
    <div className="modal-mask">
      <form className="modal-card" onSubmit={handleSubmit}>
        <div className="modal-head">
          <h2>{isRss ? "添加 RSS" : "手动添加"}</h2>

          <button type="button" onClick={onClose}>
            ×
          </button>
        </div>

        {!isRss && (
          <label>
            手动添加平台
            <select name="platformId" value={form.platformId} onChange={handleChange}>
              {platforms.map((platform) => (
                <option key={platform.id} value={platform.id}>
                  {platform.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label>
          {isRss ? "订阅源名称" : "博主或订阅源名称"}
          <input
            name="creator"
            value={form.creator}
            onChange={handleChange}
            placeholder={isRss ? "例如：Design Feed" : "例如：Design Feed"}
          />
        </label>

        <label>
          {isRss ? "RSS 链接" : "手动添加博主主页"}
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
              手动添加更新
              <input
                name="title"
                value={form.title}
                onChange={handleChange}
                placeholder="例如：本周设计灵感"
              />
            </label>

            <label>
              内容链接
              <input
                name="updateUrl"
                value={form.updateUrl}
                onChange={handleChange}
                placeholder="https://..."
              />
            </label>
          </>
        )}

        {!isRss && (
          <label>
            更新时间
            <input
              name="time"
              value={form.time}
              onChange={handleChange}
              placeholder="10:32"
            />
          </label>
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
      <p>已关联，等待下一次同步。</p>
    </div>
  );
}

function Avatar({ text }) {
  return <span className="avatar">{text}</span>;
}
