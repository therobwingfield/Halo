import { useState, useEffect, useRef } from 'react'
import { Sun, Music, Clock, PlaySquare, Play, Pause, X } from 'lucide-react'

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
        {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </div>
      <div style={{ fontSize: '18px', color: '#9bb4cf' }}>
        {time.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
      </div>
    </div>
  );
}

function StopWindow() {
  return (
    <div className="drag-region" style={{
      width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.5)', padding: '20px', borderRadius: '16px'
    }}>
      <button 
        className="danger-btn no-drag" 
        style={{ fontSize: '32px' }}
        onClick={() => {
          window.electronAPI.hideStopWindow();
        }}
      >
        STOP AUDIO
      </button>
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
  if (hash === '#/stop') return <StopWindow />;

  return <MainWindow />;
}

function MainWindow() {
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [displays, setDisplays] = useState<any[]>([]);
  const [masterBrightness, setMasterBrightness] = useState(40);
  const [audioPath, setAudioPath] = useState(localStorage.getItem('audioPath') || '');
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0); 
  const [isMorningActive, setIsMorningActive] = useState(false);
  
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume / 100;
    }
  }, [volume]);

  useEffect(() => {
    window.electronAPI.onStopAudio(() => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setIsPlaying(false);
      window.electronAPI.showMainWindow();
      setActivePanel(null);
      setIsMorningActive(false);
    });
    
    // Set internal HTML5 audio volume to 0 safely on start
    if (audioRef.current) {
      audioRef.current.volume = 0;
    }
  }, []);

  const loadDisplays = async () => {
    const res = await window.electronAPI.getDisplays();
    setDisplays(res);
  };

  const handleDimmer = () => {
    setActivePanel('dimmer');
    loadDisplays();
  };

  const setMaster = async (val: number) => {
    setMasterBrightness(val);
    await window.electronAPI.setMasterBrightness(val);
    loadDisplays();
  };

  const toggleAudio = () => {
    if (!audioRef.current || !audioPath) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const runMorning = async () => {
    // Temporarily disabled hardware changes for safe testing alongside CCP
    // await window.electronAPI.setVolume(30);
    // setVolume(30);
    // await window.electronAPI.setMasterBrightness(40);
    // setMasterBrightness(40);
    
    window.electronAPI.showClock();
    if (audioRef.current && audioPath) {
      audioRef.current.play();
      setIsPlaying(true);
    }
    
    setIsMorningActive(true);
    // Main window is NO LONGER hidden so the user can access dimmer/clock during morning
  };

  const runNap = () => {
    if (audioRef.current && audioPath) {
      audioRef.current.play();
      setIsPlaying(true);
    }
    window.electronAPI.showStopWindow();
  };

  const runWork = async () => {
    // Temporarily disabled for safe testing
    // await window.electronAPI.setMasterBrightness(100);
    
    window.electronAPI.hideClock();
    window.electronAPI.showStopWindow();
    setActivePanel(null);
    setIsMorningActive(false);
  };

  return (
    <div className="panel">
      <audio ref={audioRef} src={audioPath ? `file://${audioPath.replace(/\\/g, '/')}` : ''} loop />

      {activePanel === null ? (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {isMorningActive && (
            <button className="pad-btn" style={{ borderColor: '#37d67a', marginBottom: '8px', minHeight: '36px' }} onClick={runWork}>
              Work (End Morning)
            </button>
          )}
          <div className="main-grid" style={{ flex: 1 }}>
            <button className="pad-btn" onClick={() => setActivePanel('routine')}>
              <PlaySquare size={20} color="var(--accent)" />
              Routine
            </button>
            <button className="pad-btn" onClick={handleDimmer}>
              <Sun size={20} color="var(--accent)" />
              Dimmer
            </button>
            <button className="pad-btn" onClick={() => setActivePanel('audio')}>
              <Music size={20} color="var(--accent)" />
              Audio
            </button>
            <button className="pad-btn" onClick={() => setActivePanel('clock')}>
              <Clock size={20} color="var(--accent)" />
              Clock
            </button>
          </div>
        </div>
      ) : (
        <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ fontSize: '14px', margin: 0, color: 'var(--text-secondary)' }}>
              {activePanel.toUpperCase()}
            </h3>
            <button 
              className="no-drag"
              onClick={() => setActivePanel(null)}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              <X size={18} />
            </button>
          </div>
          
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {activePanel === 'routine' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button className="pad-btn" style={{ padding: '10px' }} onClick={runMorning}>Morning</button>
                <button className="pad-btn" style={{ padding: '10px' }} onClick={runNap}>Nap</button>
              </div>
            )}
            
            {activePanel === 'dimmer' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ minWidth: '40px', fontSize: '11px' }}>Master</span>
                  <input type="range" min="0" max="100" value={masterBrightness} onChange={(e) => setMaster(parseInt(e.target.value))} style={{ flex: 1 }} />
                  <span style={{ fontSize: '11px' }}>{masterBrightness}%</span>
                </div>
                {displays.map((d, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ minWidth: '40px', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name || `Screen ${i}`}</span>
                    <input type="range" min="0" max="100" defaultValue={d.brightness} 
                      onChange={(e) => {
                        window.electronAPI.setBrightness(d.id, parseInt(e.target.value));
                      }} 
                      style={{ flex: 1 }} />
                  </div>
                ))}
              </div>
            )}

            {activePanel === 'audio' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Audio File Path</span>
                  <input 
                    type="text" 
                    value={audioPath} 
                    onChange={(e) => {
                      setAudioPath(e.target.value);
                      localStorage.setItem('audioPath', e.target.value);
                    }}
                    placeholder="C:\Users\..." 
                    style={{ flex: 1, background: '#000', color: '#fff', border: '1px solid var(--border-color)', padding: '6px', borderRadius: '4px', fontSize: '11px' }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button onClick={toggleAudio} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}>
                    {isPlaying ? <Pause size={24} color="var(--accent)" /> : <Play size={24} color="var(--accent)" />}
                  </button>
                  <input type="range" min="0" max="100" value={volume} onChange={(e) => {
                    const v = parseInt(e.target.value);
                    setVolume(v);
                    window.electronAPI.setVolume(v);
                  }} style={{ flex: 1 }} />
                  <span style={{ fontSize: '11px' }}>{volume}%</span>
                </div>
              </div>
            )}

            {activePanel === 'clock' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="pad-btn" style={{ flex: 1 }} onClick={() => window.electronAPI.showClock()}>Show</button>
                  <button className="pad-btn" style={{ flex: 1 }} onClick={() => window.electronAPI.hideClock()}>Hide</button>
                </div>
                <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
                  <button className="pad-btn" style={{ flex: 1, fontSize: '10px', padding: '4px' }} onClick={() => window.electronAPI.setClockPosition('left')}>Left</button>
                  <button className="pad-btn" style={{ flex: 1, fontSize: '10px', padding: '4px' }} onClick={() => window.electronAPI.setClockPosition('center')}>Center</button>
                  <button className="pad-btn" style={{ flex: 1, fontSize: '10px', padding: '4px' }} onClick={() => window.electronAPI.setClockPosition('right')}>Right</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
