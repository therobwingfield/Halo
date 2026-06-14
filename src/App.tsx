import { useState, useEffect, useRef } from 'react'
import { Sun, Music, Clock, PlaySquare, Play, Pause, X, Folder } from 'lucide-react'

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
          window.electronAPI.setFeatureState('routine', false);
          window.electronAPI.sendAudioCommand('toggle-play', null);
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
  if (hash === '#/audio') return <AudioWindow />;
  if (hash === '#/dimmer') return <DimmerWindow />;
  if (hash === '#/routine') return <RoutineWindow />;
  if (hash === '#/work_btn') return <WorkButtonWindow />;
  if (hash === '#/clock_ctrl') return <ClockControlWindow />;

  return <MainMenu />;
}

function MainMenu() {
  // The global Audio Engine runs invisibly here
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  const [audioPath, setAudioPath] = useState(localStorage.getItem('audioPath') || '');
  const [activeFeatures, setActiveFeatures] = useState<Record<string, boolean>>({ dimmer: true });
  // Store logical volume 0-100 to report back to UI
  const logicalVolume = useRef<number>(0);

  const initAudioCtx = () => {
    if (audioRef.current && !audioContextRef.current) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        const audioCtx = new AudioContextClass();
        const gainNode = audioCtx.createGain();
        const track = audioCtx.createMediaElementSource(audioRef.current);
        track.connect(gainNode).connect(audioCtx.destination);
        
        audioContextRef.current = audioCtx;
        gainNodeRef.current = gainNode;
        gainNode.gain.value = 0;
        audioRef.current.volume = 1.0; // Max out base element, control via gain
      }
    }
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
  };

  useEffect(() => {
    // Safely set initial volume to 0
    if (audioRef.current) {
      audioRef.current.volume = 0;
    }

    // Listen for commands from the Audio Popout
    window.electronAPI.onSyncAudioCommand((_event: any, command: string, payload: any) => {
      if (!audioRef.current) return;
      initAudioCtx();

      if (command === 'toggle-play') {
        if (audioRef.current.paused) audioRef.current.play();
        else audioRef.current.pause();
      } else if (command === 'set-volume') {
        logicalVolume.current = payload;
        if (gainNodeRef.current) {
          // Payload 0-100 maps to 0.0 - 5.0 (500% gain boost)
          gainNodeRef.current.gain.value = payload * 0.05;
        }
      } else if (command === 'set-time') {
        audioRef.current.currentTime = payload;
      } else if (command === 'set-path') {
        setAudioPath(payload);
        localStorage.setItem('audioPath', payload);
      }
    });

    window.electronAPI.getFeatureStates().then(setActiveFeatures);
    window.electronAPI.onSyncFeatureStates((_event: any, states: any) => {
      setActiveFeatures(states);
    });


    // Send state updates TO the Audio Popout constantly
    const interval = setInterval(() => {
      if (audioRef.current) {
        window.electronAPI.sendAudioStateUpdate({
          isPlaying: !audioRef.current.paused,
          currentTime: audioRef.current.currentTime,
          duration: audioRef.current.duration,
          volume: logicalVolume.current,
          audioPath: audioPath
        });
      }
    }, 200);
    return () => clearInterval(interval);
  }, [audioPath]);

  useEffect(() => {
    window.electronAPI.onStopAudio(() => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      window.electronAPI.showMainWindow();
    });
  }, []);

  return (
    <div className="panel drag-region" style={{ display: 'flex', flexDirection: 'column' }}>
      <audio 
        ref={audioRef} 
        src={audioPath ? encodeURI(`app://localhost/${audioPath.replace(/\\/g, '/')}`) : ''} 
        loop 
      />
      <div className="main-grid no-drag" style={{ flex: 1 }}>
        <button className="pad-btn" 
                style={{ background: activeFeatures['routine'] ? 'rgba(46, 213, 115, 0.2)' : undefined, borderColor: activeFeatures['routine'] ? '#2ed573' : undefined }}
                onClick={() => window.electronAPI.openPopout('routine', '/routine', 260, 180)}>
          <PlaySquare size={24} color={activeFeatures['routine'] ? '#2ed573' : 'var(--accent)'} />
          Routine
        </button>
        <button className="pad-btn" 
                style={{ background: activeFeatures['dimmer'] ? 'rgba(46, 213, 115, 0.2)' : undefined, borderColor: activeFeatures['dimmer'] ? '#2ed573' : undefined }}
                onClick={() => window.electronAPI.openPopout('dimmer', '/dimmer', 350, 250)}>
          <Sun size={24} color={activeFeatures['dimmer'] ? '#2ed573' : 'var(--accent)'} />
          Dimmer
        </button>
        <button className="pad-btn" 
                style={{ background: activeFeatures['audio'] ? 'rgba(46, 213, 115, 0.2)' : undefined, borderColor: activeFeatures['audio'] ? '#2ed573' : undefined }}
                onClick={() => window.electronAPI.openPopout('audio', '/audio', 450, 200)}>
          <Music size={24} color={activeFeatures['audio'] ? '#2ed573' : 'var(--accent)'} />
          Audio
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

function AudioWindow() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0);
  const [audioPath, setAudioPath] = useState('');
  const [albumArt, setAlbumArt] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI.onSyncAudioState((_event: any, state: any) => {
      setIsPlaying(state.isPlaying);
      setCurrentTime(state.currentTime);
      setDuration(state.duration);
      setVolume(state.volume);
      if (state.audioPath !== audioPath) {
        setAudioPath(state.audioPath);
      }
    });
  }, [audioPath]);

  useEffect(() => {
    const fetchMetadata = async () => {
      if (audioPath) {
        const art = await window.electronAPI.getAudioMetadata(audioPath);
        setAlbumArt(art);
      }
    };
    fetchMetadata();
  }, [audioPath]);

  const formatTime = (time: number) => {
    if (isNaN(time)) return "00:00:00";
    const h = Math.floor(time / 3600).toString().padStart(2, '0');
    const m = Math.floor((time % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(time % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  return (
    <div className="panel drag-region" style={{ display: 'flex', flexDirection: 'column', padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ fontSize: '14px', margin: 0, color: 'var(--text-primary)', letterSpacing: '2px', fontWeight: 'bold' }}>AUDIO</h3>
        <button className="no-drag" onClick={() => window.electronAPI.closePopout('audio')} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}><X size={18} /></button>
      </div>

      <div className="no-drag" style={{ display: 'flex', flexDirection: 'column', gap: '12px', justifyContent: 'center' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', justifyContent: 'flex-end' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
            {audioPath ? audioPath.split('\\').pop() : 'No file selected'}
          </span>
          <button 
            onClick={async () => {
              const path = await window.electronAPI.selectAudioFile();
              if (path) window.electronAPI.sendAudioCommand('set-path', path);
            }} 
            style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer', padding: '6px', color: '#fff', display: 'flex', alignItems: 'center' }}
          >
            <Folder size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <div style={{ width: '80px', height: '80px', borderRadius: '8px', background: 'rgba(0,0,0,0.5)', border: '1px solid var(--border-color)', overflow: 'hidden', flexShrink: 0 }}>
            <img src={albumArt || '/placeholder.png'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="Art" />
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button onClick={() => window.electronAPI.sendAudioCommand('toggle-play', null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}>
                {isPlaying ? <Pause size={28} color="#ff0000" fill="#ff0000" /> : <Play size={28} color="#ff0000" fill="#ff0000" />}
              </button>
              <div style={{ display: 'flex', alignItems: 'center', flex: 1, gap: '12px' }}>
                <input 
                  type="range" min="0" max={duration || 100} value={currentTime} className="youtube-scrubber"
                  onChange={(e) => window.electronAPI.sendAudioCommand('set-time', parseFloat(e.target.value))} 
                  style={{ flex: 1, background: `linear-gradient(to right, #ff0000 ${(currentTime / (duration || 1)) * 100}%, rgba(255,255,255,0.2) ${(currentTime / (duration || 1)) * 100}%)` }} 
                />
                <span style={{ fontSize: '11px', color: '#ccc', minWidth: '75px', textAlign: 'right', fontFamily: 'monospace' }}>
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingLeft: '4px' }}>
              <span style={{ fontSize: '11px', minWidth: '45px', color: 'var(--text-secondary)' }}>Vol</span>
              <input type="range" min="0" max="100" value={volume} onChange={(e) => window.electronAPI.sendAudioCommand('set-volume', parseInt(e.target.value))} style={{ flex: 1 }} />
              <span style={{ fontSize: '11px', minWidth: '30px', textAlign: 'right', fontFamily: 'monospace' }}>{volume}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DimmerWindow() {
  const [displays, setDisplays] = useState<any[]>([]);
  const [masterBrightness, setMasterBrightness] = useState<number>(40);
  const [isEnabled, setIsEnabled] = useState(true);

  useEffect(() => {
    window.electronAPI.getFeatureStates().then((states: any) => setIsEnabled(states.dimmer ?? true));
    window.electronAPI.onSyncFeatureStates((_event: any, states: any) => {
      setIsEnabled(states.dimmer ?? true);
    });
  }, []);

  useEffect(() => {
    const loadDisplays = async () => {
      const res = await window.electronAPI.getDisplays();
      if (res.length > 0) {
        // Map hardware brightness 0-100 to slider 50-100
        const avg = res.reduce((acc: number, d: any) => acc + d.brightness, 0) / res.length;
        setMasterBrightness(50 + (avg / 2));
      }
      setDisplays(res.map((d: any) => ({ ...d, unifiedBrightness: 50 + (d.brightness / 2) })));
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
      
      {/* Massive Enable/Disable button outside the disabled pointer area */}
      <div className="no-drag" style={{ marginTop: '16px' }}>
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

function WorkButtonWindow() {
  return (
    <div className="drag-region" style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)', padding: '16px', borderRadius: '16px'
    }}>
      <div style={{ height: '6px', width: '40px', background: 'rgba(255,255,255,0.4)', borderRadius: '4px', marginBottom: '12px' }} />
      <button 
        className="no-drag" 
        style={{ 
          background: 'var(--accent)', color: '#000', border: 'none', padding: '12px 24px', 
          borderRadius: '16px', fontWeight: 'bold', cursor: 'pointer', fontSize: '18px', width: '100%' 
        }}
        onClick={async () => {
          window.electronAPI.setFeatureState('dimmer', false);
          await window.electronAPI.setMasterBrightness(100);
          await window.electronAPI.setSoftwareDim('master', 0);
          window.electronAPI.hideClock();
          window.electronAPI.showStopWindow();
          window.electronAPI.hideWorkButton();
        }}
      >
        Leave for Work
      </button>
    </div>
  );
}

function RoutineWindow() {
  const runMorning = async () => {
    window.electronAPI.setFeatureState('routine', true);
    window.electronAPI.showClock();
    window.electronAPI.sendAudioCommand('toggle-play', null); 
    window.electronAPI.showWorkButton();
    window.electronAPI.closePopout('routine');
  };

  const runNap = () => {
    window.electronAPI.setFeatureState('routine', true);
    window.electronAPI.sendAudioCommand('toggle-play', null);
    window.electronAPI.showStopWindow();
    window.electronAPI.closePopout('routine');
  };

  return (
    <div className="panel drag-region" style={{ display: 'flex', flexDirection: 'column', padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ fontSize: '14px', margin: 0, color: 'var(--text-primary)', letterSpacing: '2px', fontWeight: 'bold' }}>ROUTINE</h3>
        <button className="no-drag" onClick={() => window.electronAPI.closePopout('routine')} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}><X size={18} /></button>
      </div>
      <div className="no-drag" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <button className="pad-btn" style={{ padding: '12px' }} onClick={runMorning}>Execute Morning</button>
        <button className="pad-btn" style={{ padding: '12px' }} onClick={runNap}>Execute Nap</button>
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
