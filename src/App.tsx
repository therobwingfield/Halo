import { useState, useEffect } from 'react'
import { Sun, Clock, X } from 'lucide-react'

// Define global electronAPI
declare global {
  interface Window {
    electronAPI: any;
  }
}

function ClockWindow() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="drag-region" style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', color: '#fff',
      textShadow: '0 2px 10px rgba(0,0,0,0.8)',
      userSelect: 'none'
    }}>
      <div style={{ fontSize: '48px', fontWeight: 'bold' }}>
        {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
      </div>
      <div style={{ fontSize: '18px', color: '#9bb4cf' }}>
        {time.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
      </div>
    </div>
  );
}

export default function App() {
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    const handleHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  if (hash === '#/clock') return <ClockWindow />;
  if (hash === '#/dimmer') return <DimmerWindow />;
  if (hash === '#/clock_ctrl') return <ClockControlWindow />;

  return <MainMenu />;
}

function MainMenu() {
  const [activeFeatures, setActiveFeatures] = useState<Record<string, boolean>>({ dimmer: true });

  useEffect(() => {
    window.electronAPI.getFeatureStates().then(setActiveFeatures);
    const handler = (_event: any, states: any) => setActiveFeatures(states);
    window.electronAPI.onSyncFeatureStates(handler);
  }, []);

  return (
    <div className="panel drag-region" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="main-grid no-drag" style={{ flex: 1 }}>
        <button className="pad-btn"
                style={{ background: activeFeatures['dimmer'] ? 'rgba(46, 213, 115, 0.2)' : undefined, borderColor: activeFeatures['dimmer'] ? '#2ed573' : undefined }}
                onClick={() => window.electronAPI.openPopout('dimmer', '/dimmer', 360, 470)}>
          <Sun size={24} color={activeFeatures['dimmer'] ? '#2ed573' : 'var(--accent)'} />
          Dimmer
        </button>
        <button className="pad-btn"
                style={{ background: activeFeatures['clock_ctrl'] ? 'rgba(46, 213, 115, 0.2)' : undefined, borderColor: activeFeatures['clock_ctrl'] ? '#2ed573' : undefined }}
                onClick={() => window.electronAPI.openPopout('clock_ctrl', '/clock_ctrl', 280, 160)}>
          <Clock size={24} color={activeFeatures['clock_ctrl'] ? '#2ed573' : 'var(--accent)'} />
          Clock
        </button>
      </div>
    </div>
  );
}

function DimmerWindow() {
  const [displays, setDisplays] = useState<any[]>([]);
  const [masterBrightness, setMasterBrightness] = useState<number>(50);
  const [isEnabled, setIsEnabled] = useState(true);
  const [auto, setAuto] = useState<any>({ enabled: true, maxOpacity: 0.62, displays: [] });
  const [recovery, setRecovery] = useState<any>(null);

  // Live auto-dim readout. Polls the main process, which owns the sampler.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const s = await window.electronAPI.getAutoDimState();
        if (alive && s) setAuto(s);
      } catch (e) { /* ignore */ }
    };
    poll();
    const t = setInterval(poll, 500);
    window.electronAPI.getRecoveryState?.().then((r: any) => { if (alive) setRecovery(r); }).catch(() => {});
    return () => { alive = false; clearInterval(t); };
  }, []);

  const toggleAuto = async () => {
    const next = !auto.enabled;
    await window.electronAPI.setAutoDimEnabled(next);
    setAuto((a: any) => ({ ...a, enabled: next }));
  };

  const restoreMonitors = async () => {
    await window.electronAPI.restoreHardware();
    setMasterBrightness(100);
    setDisplays(prev => prev.map((d: any) => ({ ...d, unifiedBrightness: 100 })));
  };

  useEffect(() => {
    window.electronAPI.getFeatureStates().then((states: any) => setIsEnabled(states.dimmer ?? true));
    const handler = (_event: any, states: any) => setIsEnabled(states.dimmer ?? true);
    window.electronAPI.onSyncFeatureStates(handler);
  }, []);

  useEffect(() => {
    const loadDisplays = async () => {
      const res = await window.electronAPI.getDisplays();

      // Hardware brightness only ever describes the 50-100 half of the slider: every
      // position at or below 50 sets hardware 0 and dims with the overlay instead. So
      // hardware alone cannot place the handle in the lower half, and reading it back was
      // resolving a restored software floor to 50 (= no dimming) on every launch.
      // The persisted floor (A7) is the only source for that half.
      let floor = 0;
      try {
        const st: any = await window.electronAPI.getAutoDimState();
        // Max across panels: the master slider writes one floor to all of them, and where
        // they differ the darker value is the safe one to display.
        floor = (st?.displays ?? []).reduce(
          (m: number, d: any) => Math.max(m, d.manualOpacity ?? 0), 0);
      } catch { /* fall back to the hardware-derived position */ }

      const toSlider = (hardware: number) =>
        floor > 0 ? Math.max(0, 50 - (floor / 0.9) * 50) : 50 + (hardware / 2);

      if (res.length > 0) {
        const avg = res.reduce((acc: number, d: any) => acc + d.brightness, 0) / res.length;
        setMasterBrightness(toSlider(avg));
      }
      setDisplays(res.map((d: any) => ({ ...d, unifiedBrightness: toSlider(d.brightness) })));
    };
    loadDisplays();
  }, []);

  const setMaster = (val: number) => {
    setMasterBrightness(val);
    setDisplays(prev => prev.map(d => ({ ...d, unifiedBrightness: val })));

    if (!isEnabled) return;
    // Instantly update software dimming on drag
    let swOpacity = 0;
    if (val <= 50) {
      swOpacity = 0.9 * ((50 - val) / 50);
    }
    window.electronAPI.setSoftwareDim('master', swOpacity);
  };

  const setSingle = (id: string, val: number) => {
    setDisplays(prev => prev.map(disp => disp.id === id ? { ...disp, unifiedBrightness: val } : disp));

    if (!isEnabled) return;
    // Instantly update software dimming on drag
    let swOpacity = 0;
    if (val <= 50) {
      swOpacity = 0.9 * ((50 - val) / 50);
    }
    window.electronAPI.setSoftwareDim(id, swOpacity);
  };

  const handleMasterRelease = async () => {
    if (!isEnabled) return;
    let hwVal = 0;
    if (masterBrightness > 50) {
      hwVal = Math.round((masterBrightness - 50) * 2);
    }
    await window.electronAPI.setMasterBrightness(hwVal);
  };

  const handleSingleRelease = async (id: string, val: number) => {
    if (!isEnabled) return;
    let hwVal = 0;
    if (val > 50) {
      hwVal = Math.round((val - 50) * 2);
    }
    await window.electronAPI.setBrightness(id, hwVal);
  };

  const toggleDimmer = async () => {
    const next = !isEnabled;
    setIsEnabled(next);
    window.electronAPI.setFeatureState('dimmer', next);
    if (!next) {
      // Force 100% brightness
      await window.electronAPI.setMasterBrightness(100);
      await window.electronAPI.setSoftwareDim('master', 0);
      setMasterBrightness(100);
      setDisplays(prev => prev.map((d: any) => ({ ...d, unifiedBrightness: 100 })));
    } else {
      let hwVal = 0;
      let swOpacity = 0;
      if (masterBrightness > 50) {
        hwVal = Math.round((masterBrightness - 50) * 2);
      } else {
        swOpacity = 0.9 * ((50 - masterBrightness) / 50);
      }
      await window.electronAPI.setMasterBrightness(hwVal);
      await window.electronAPI.setSoftwareDim('master', swOpacity);
    }
  };

  return (
    <div className="panel drag-region" style={{ display: 'flex', flexDirection: 'column', padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h3 style={{ fontSize: '14px', margin: 0, color: 'var(--text-primary)', letterSpacing: '2px', fontWeight: 'bold' }}>DIMMER</h3>
        </div>
        <button className="no-drag" onClick={() => window.electronAPI.closePopout('dimmer')} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}><X size={18} /></button>
      </div>
      <div className="no-drag" style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1, overflowY: 'auto', opacity: isEnabled ? 1 : 0.5, pointerEvents: isEnabled ? 'auto' : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ minWidth: '50px', fontSize: '11px', color: 'var(--text-secondary)' }}>Master</span>
          <input type="range" min="0" max="100" value={masterBrightness}
            onChange={(e) => setMaster(parseInt(e.target.value))}
            onPointerUp={handleMasterRelease}
            style={{ flex: 1 }} />
          <span style={{ fontSize: '11px', minWidth: '30px', textAlign: 'right' }}>{Math.round(masterBrightness)}%</span>
        </div>
        {displays.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ minWidth: '50px', fontSize: '11px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d.name ? d.name.substring(0, 8) : `Scr ${i}`}
            </span>
            <input type="range" min="0" max="100" value={d.unifiedBrightness || 0}
              onChange={(e) => setSingle(d.id, parseInt(e.target.value))}
              onPointerUp={() => handleSingleRelease(d.id, d.unifiedBrightness)}
              style={{ flex: 1 }} />
          </div>
        ))}
      </div>

      {/* Auto-dim: content-adaptive dimming, active whenever Halo runs */}
      <div className="no-drag" style={{ marginTop: '14px', borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '11px', letterSpacing: '1px', color: 'var(--text-primary)', fontWeight: 'bold' }}>AUTO-DIM</span>
          <button onClick={toggleAuto} style={{
            fontSize: '10px', padding: '3px 10px', borderRadius: '6px', cursor: 'pointer',
            background: auto.enabled ? 'rgba(46,213,115,0.18)' : 'rgba(255,255,255,0.06)',
            border: `1px solid ${auto.enabled ? '#2ed573' : 'rgba(255,255,255,0.25)'}`,
            color: auto.enabled ? '#2ed573' : 'var(--text-secondary)'
          }}>{auto.enabled ? 'ON' : 'OFF'}</button>
        </div>

        {(auto.displays || []).map((d: any) => (
          <div key={d.index} style={{ marginBottom: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-secondary)' }}>
              <span>Screen {d.index + 1}</span>
              <span>content {Math.round(d.luma * 100)}% → dim {Math.round((d.effective ?? d.autoOpacity) * 100)}%</span>
            </div>
            <div style={{ height: '4px', background: 'rgba(255,255,255,0.10)', borderRadius: '2px', overflow: 'hidden', marginTop: '3px' }}>
              <div style={{ width: `${Math.round((d.effective ?? d.autoOpacity) * 100)}%`, height: '100%', background: '#2ed573', transition: 'width 120ms linear' }} />
            </div>
            {/* A6 — per-panel calibration. Additive, so it holds when auto-dim takes over. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
              <span style={{ fontSize: '9px', color: 'var(--text-secondary)', minWidth: '30px' }}>Trim</span>
              <input type="range" min="0" max="40" value={Math.round((d.trim ?? 0) * 100)}
                onChange={(e) => {
                  const v = parseInt(e.target.value) / 100;
                  setAuto((a: any) => ({
                    ...a,
                    displays: a.displays.map((x: any) => x.index === d.index ? { ...x, trim: v } : x)
                  }));
                  window.electronAPI.setDisplayTrim(d.index, v);
                }}
                style={{ flex: 1 }} />
              <span style={{ fontSize: '9px', minWidth: '26px', textAlign: 'right' }}>+{Math.round((d.trim ?? 0) * 100)}%</span>
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-secondary)', minWidth: '52px' }}>Strength</span>
          <input type="range" min="0" max="90" value={Math.round((auto.maxOpacity ?? 0.62) * 100)}
            onChange={(e) => {
              const v = parseInt(e.target.value) / 100;
              setAuto((a: any) => ({ ...a, maxOpacity: v }));
              window.electronAPI.setAutoDimStrength(v);
            }}
            style={{ flex: 1 }} />
          <span style={{ fontSize: '10px', minWidth: '28px', textAlign: 'right' }}>{Math.round((auto.maxOpacity ?? 0.62) * 100)}%</span>
        </div>
      </div>

      {/* Hand the monitors back to their pre-Halo brightness (survives a crash, see A1) */}
      <div className="no-drag" style={{ marginTop: '10px' }}>
        <button onClick={restoreMonitors} style={{
          width: '100%', padding: '8px', borderRadius: '8px', cursor: 'pointer',
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.25)',
          color: 'var(--text-secondary)', fontSize: '11px', letterSpacing: '0.5px'
        }}>
          RESTORE MONITORS{recovery?.preHaloBrightness?.length ? ` (${recovery.preHaloBrightness[0].brightness}%)` : ''}
        </button>
        {recovery?.uncleanPreviousExit && (
          <div style={{ fontSize: '9px', color: '#ffa502', marginTop: '5px', textAlign: 'center' }}>
            Last session ended unexpectedly — brightness was not restored.
          </div>
        )}
      </div>

      {/* Massive Enable/Disable button outside the disabled pointer area */}
      <div className="no-drag" style={{ marginTop: '12px' }}>
        <button onClick={toggleDimmer} style={{
          width: '100%',
          padding: '12px',
          borderRadius: '8px',
          background: isEnabled ? 'rgba(255, 50, 50, 0.2)' : 'rgba(46, 213, 115, 0.2)',
          border: `1px solid ${isEnabled ? '#ff4757' : '#2ed573'}`,
          color: isEnabled ? '#ff4757' : '#2ed573',
          cursor: 'pointer',
          fontWeight: 'bold',
          letterSpacing: '1px',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '8px'
        }}>
          {isEnabled ? 'DISABLE DIMMER' : 'ENABLE DIMMER'}
        </button>
      </div>
    </div>
  );
}

function ClockControlWindow() {
  return (
    <div className="panel drag-region" style={{ display: 'flex', flexDirection: 'column', padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ fontSize: '14px', margin: 0, color: 'var(--text-primary)', letterSpacing: '2px', fontWeight: 'bold' }}>CLOCK CONTROLS</h3>
        <button className="no-drag" onClick={() => window.electronAPI.closePopout('clock_ctrl')} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}><X size={18} /></button>
      </div>
      <div className="no-drag" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="pad-btn" style={{ flex: 1, padding: '10px' }} onClick={() => window.electronAPI.showClock()}>Show</button>
          <button className="pad-btn" style={{ flex: 1, padding: '10px' }} onClick={() => window.electronAPI.hideClock()}>Hide</button>
        </div>
        <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
          <button className="pad-btn" style={{ flex: 1, fontSize: '11px', padding: '6px' }} onClick={() => window.electronAPI.setClockPosition('left')}>Left</button>
          <button className="pad-btn" style={{ flex: 1, fontSize: '11px', padding: '6px' }} onClick={() => window.electronAPI.setClockPosition('center')}>Center</button>
          <button className="pad-btn" style={{ flex: 1, fontSize: '11px', padding: '6px' }} onClick={() => window.electronAPI.setClockPosition('right')}>Right</button>
        </div>
      </div>
    </div>
  );
}
