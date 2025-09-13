import React from 'react';

export default function SettingsPanel({
  detail,
  setDetail,
  heatmapOn,
  setHeatmapOn,
  useProxy,
  setUseProxy,
  autoScaleRef,
}) {
  return (
    <div className="settings-panel">
      <div className="settings-row">
        <label>Detail</label>
        <select value={detail} onChange={(e) => setDetail(e.target.value)}>
          <option value="auto">Auto</option>
          <option value="high">High</option>
          <option value="low">Low</option>
        </select>
      </div>
      <div className="settings-row">
        <label>Heatmap</label>
        <input type="checkbox" checked={heatmapOn} onChange={(e) => setHeatmapOn(e.target.checked)} />
      </div>
      <div className="settings-row">
        <label>Use Proxy</label>
        <input type="checkbox" checked={useProxy} onChange={(e) => setUseProxy(e.target.checked)} />
      </div>
      <div className="settings-row">
        <button onClick={() => { autoScaleRef.current = 1; }}>Reset Autotune</button>
      </div>
    </div>
  );
}
