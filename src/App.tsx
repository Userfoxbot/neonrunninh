import React, { useEffect, useRef, useState, useCallback } from 'react';
import { 
  Play, RotateCcw, Wallet, Gamepad2, Gift, 
  CircleDollarSign, Clock, Trophy, ChevronRight, Users, ListTodo, CheckCircle2, CreditCard
} from 'lucide-react';
import { db, auth, handleFirestoreError, OperationType, signInWithGoogle } from './firebase';
import { collection, query, orderBy, limit, onSnapshot, doc, setDoc, getDoc, serverTimestamp, getDocs } from 'firebase/firestore';

const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 400;
const GROUND_HEIGHT = 40;

// Type definition for Telegram Web App API if available
declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initDataUnsafe?: {
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
          }
        }
      }
    }
  }
}

const getTelegramUsername = () => {
  const user = window.Telegram?.WebApp?.initDataUnsafe?.user;
  if (user) {
    return user.username || user.first_name || `User${user.id}`;
  }
  return 'Anonymous Player'; // Fallback
};

async function saveHighScoreToLeaderboard(newScore: number) {
  if (!auth.currentUser) return;
  const uid = auth.currentUser.uid;
  const username = getTelegramUsername();
  
  try {
    const docRef = doc(db, 'leaderboard', uid);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists() || docSnap.data().highScore < newScore) {
      await setDoc(docRef, {
        userId: uid,
        username: username,
        highScore: newScore,
        updatedAt: serverTimestamp()
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'leaderboard');
  }
}


interface Entity {
  x: number;
  y: number;
  width: number;
  height: number;
  markedForDeletion?: boolean;
}

interface GameProps {
  onReward: (amount: number) => void;
}

function GameView({ onReward }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<'START' | 'PLAYING' | 'GAME_OVER'>('START');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);

  const gameStateRef = useRef({
    state: 'START',
    score: 0,
    speed: 6,
    frames: 0
  });

  const playerRef = useRef({
    x: 100,
    y: CANVAS_HEIGHT - GROUND_HEIGHT - 40,
    width: 30,
    height: 40,
    vy: 0,
    jumpForce: -13,
    gravity: 0.65,
    grounded: true
  });

  const obstaclesRef = useRef<Entity[]>([]);
  const coinsRef = useRef<(Entity & { collected: boolean, hoverOffset: number })[]>([]);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    const saved = localStorage.getItem('runner_highscore');
    if (saved) setHighScore(parseInt(saved, 10));
  }, []);

  const resetGame = useCallback(() => {
    gameStateRef.current = {
      state: 'PLAYING',
      score: 0,
      speed: 6,
      frames: 0
    };
    playerRef.current = {
      ...playerRef.current,
      y: CANVAS_HEIGHT - GROUND_HEIGHT - playerRef.current.height,
      vy: 0,
      grounded: true
    };
    obstaclesRef.current = [];
    coinsRef.current = [];
    setScore(0);
    setGameState('PLAYING');
  }, []);

  const jump = useCallback(() => {
    if (gameStateRef.current.state === 'PLAYING' && playerRef.current.grounded) {
      playerRef.current.vy = playerRef.current.jumpForce;
      playerRef.current.grounded = false;
    } else if (gameStateRef.current.state === 'START' || gameStateRef.current.state === 'GAME_OVER') {
      resetGame();
    }
  }, [resetGame]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        jump();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [jump]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const checkCollision = (rect1: Entity, rect2: Entity) => {
      // Shrunk bounding box slightly for fair gameplay
      const padding = 5;
      return (
        rect1.x < rect2.x + rect2.width - padding &&
        rect1.x + rect1.width > rect2.x + padding &&
        rect1.y < rect2.y + rect2.height - padding &&
        rect1.y + rect1.height > rect2.y + padding
      );
    };

    const drawBackground = () => {
      // Motion blur trail effect
      ctx.fillStyle = 'rgba(5, 5, 10, 0.4)';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      
      // Cyber ground line
      ctx.fillStyle = '#0ea5e9';
      ctx.shadowColor = '#0ea5e9';
      ctx.shadowBlur = 15;
      ctx.fillRect(0, CANVAS_HEIGHT - GROUND_HEIGHT, CANVAS_WIDTH, 4);
      
      // Deep ground structure
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, CANVAS_HEIGHT - GROUND_HEIGHT + 4, CANVAS_WIDTH, GROUND_HEIGHT - 4);
      
      // Synthwave-style grid lines on ground
      ctx.fillStyle = 'rgba(14, 165, 233, 0.2)';
      const state = gameStateRef.current;
      const offset = (state.frames * state.speed) % 40;
      for (let i = 0; i <= CANVAS_WIDTH; i += 40) {
        ctx.fillRect(i - offset, CANVAS_HEIGHT - GROUND_HEIGHT + 4, 2, GROUND_HEIGHT);
      }
    };

    const drawPlayer = () => {
      const p = playerRef.current;
      ctx.shadowColor = '#0ea5e9';
      ctx.shadowBlur = 15;
      ctx.fillStyle = '#ccfbf1';
      
      ctx.fillRect(p.x, p.y, p.width, p.height);
      
      // Eye detail
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#020617';
      ctx.fillRect(p.x + 18, p.y + 10, 6, 6);
    };

    const updatePlay = () => {
      const state = gameStateRef.current;
      const p = playerRef.current;
      
      state.frames++;
      if (state.frames % 500 === 0 && state.speed < 15) {
        state.speed += 0.4;
      }

      // Physics
      p.vy += p.gravity;
      p.y += p.vy;

      if (p.y + p.height >= CANVAS_HEIGHT - GROUND_HEIGHT) {
        p.y = CANVAS_HEIGHT - GROUND_HEIGHT - p.height;
        p.vy = 0;
        p.grounded = true;
      }

      // Spawn Obstacles (Red Market Candles)
      if (state.frames % 100 === 0 || (Math.random() < 0.01 && state.frames % 40 !== 0)) {
        const lastObs = obstaclesRef.current[obstaclesRef.current.length - 1];
        if (!lastObs || CANVAS_WIDTH - lastObs.x > 220) {
          const height = 40 + Math.random() * 50;
          obstaclesRef.current.push({
            x: CANVAS_WIDTH,
            y: CANVAS_HEIGHT - GROUND_HEIGHT - height,
            width: 25 + Math.random() * 20,
            height: height
          });
        }
      }

      // Spawn Coins ($RUN tokens)
      if (state.frames % 60 === 0) {
        const isHigh = Math.random() > 0.5;
        const y = isHigh ? CANVAS_HEIGHT - GROUND_HEIGHT - 130 : CANVAS_HEIGHT - GROUND_HEIGHT - 50;
        coinsRef.current.push({
          x: CANVAS_WIDTH + 50,
          y,
          width: 24,
          height: 24,
          collected: false,
          hoverOffset: Math.random() * Math.PI * 2
        });
      }

      // Handle Obstacles
      for (let i = 0; i < obstaclesRef.current.length; i++) {
        const obs = obstaclesRef.current[i];
        obs.x -= state.speed;
        
        ctx.shadowColor = '#ef4444';
        ctx.shadowBlur = 15;
        ctx.fillStyle = '#fca5a5';
        ctx.fillRect(obs.x, obs.y, obs.width, obs.height);
        // Candlestick wick
        ctx.fillRect(obs.x + obs.width/2 - 2, obs.y - 15, 4, obs.height + 25);
        ctx.shadowBlur = 0;

        if (checkCollision(p, obs)) {
          state.state = 'GAME_OVER';
          setGameState('GAME_OVER');
          if (state.score > highScore) {
            setHighScore(state.score);
            localStorage.setItem('runner_highscore', state.score.toString());
            saveHighScoreToLeaderboard(state.score);
          }
          // Grant funds to wallet
          if (state.score > 0) {
             onReward(state.score);
          }
        }
        if (obs.x + obs.width < 0) obs.markedForDeletion = true;
      }

      // Handle Coins
      for (let i = 0; i < coinsRef.current.length; i++) {
        const coin = coinsRef.current[i];
        coin.x -= state.speed;
        const hover = Math.sin((state.frames * 0.1) + coin.hoverOffset) * 5;

        if (!coin.collected) {
          ctx.shadowColor = '#eab308';
          ctx.shadowBlur = 15;
          ctx.fillStyle = '#fef08a';
          ctx.beginPath();
          ctx.arc(coin.x + coin.width / 2, coin.y + coin.height / 2 + hover, 12, 0, Math.PI * 2);
          ctx.fill();
          
          ctx.fillStyle = '#854d0e';
          ctx.font = 'bold 16px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('$', coin.x + coin.width / 2, coin.y + coin.height / 2 + hover);
          ctx.shadowBlur = 0;

          if (checkCollision(p, coin)) {
            coin.collected = true;
            state.score += 5; // $5 RUN per token
            setScore(state.score);
          }
        }
        if (coin.x + coin.width < 0) coin.markedForDeletion = true;
      }

      obstaclesRef.current = obstaclesRef.current.filter(obs => !obs.markedForDeletion);
      coinsRef.current = coinsRef.current.filter(coin => !coin.markedForDeletion && !coin.collected);
    };

    const loop = () => {
      drawBackground();

      if (gameStateRef.current.state === 'PLAYING') {
        updatePlay();
        drawPlayer();
      } else if (gameStateRef.current.state === 'START' || gameStateRef.current.state === 'GAME_OVER') {
        drawPlayer();
        // Render environment for static UI backgrounds
        ctx.shadowBlur = 0;
        obstaclesRef.current.forEach(obs => {
          ctx.fillStyle = '#fca5a5';
          ctx.fillRect(obs.x, obs.y, obs.width, obs.height);
          ctx.fillRect(obs.x + obs.width/2 - 2, obs.y - 15, 4, obs.height + 25);
        });
        coinsRef.current.forEach(coin => {
          if (!coin.collected) {
            ctx.fillStyle = '#fef08a';
            ctx.beginPath();
            ctx.arc(coin.x + coin.width / 2, coin.y + coin.height / 2, 12, 0, Math.PI * 2);
            ctx.fill();
          }
        });
      }

      animationRef.current = requestAnimationFrame(loop);
    };

    animationRef.current = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(animationRef.current);
  }, [highScore, onReward]);

  return (
    <div className="flex flex-col items-center justify-center h-full p-4 touch-none" onClick={jump}>
      
      <div className="w-full max-w-lg mb-4 flex justify-between items-end select-none mt-2">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center mb-1">
            <span className="text-cyan-400 font-black tracking-widest italic mr-2">NEON RUN</span>
          </h2>
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider backdrop-blur-md px-2 py-1 bg-zinc-900/50 rounded-lg inline-block">
            High Score: <span className="text-cyan-400 font-mono text-sm ml-1">{highScore}</span>
          </div>
        </div>

        <div className="text-right">
           <div className="text-2xl font-black bg-zinc-900/80 px-4 py-2 rounded-xl border border-zinc-800 shadow-[0_0_15px_rgba(14,165,233,0.15)] flex items-center gap-2">
            <CircleDollarSign className="w-5 h-5 text-yellow-400" />
            <span className="bg-gradient-to-r from-yellow-300 to-yellow-500 bg-clip-text text-transparent font-mono">{score}</span>
          </div>
        </div>
      </div>

      <div className="relative w-full max-w-lg aspect-[3/2] rounded-2xl overflow-hidden shadow-[0_0_40px_rgba(0,0,0,0.8)] border border-zinc-800 bg-[#05050a] cursor-pointer ring-1 ring-zinc-800/50 group">
        
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="w-full h-full block"
        />

        {/* Start Screen Overlay */}
        {gameState === 'START' && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center p-4 sm:p-6 text-center">
            <div className="w-12 h-12 sm:w-16 sm:h-16 bg-cyan-500 rounded-full flex items-center justify-center mb-3 sm:mb-4 shadow-[0_0_30px_rgba(6,182,212,0.6)] animate-pulse">
              <Play className="w-6 h-6 sm:w-8 sm:h-8 text-black ml-1 pb-0.5" />
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-white mb-2 uppercase tracking-wide">Run to Earn</h2>
            <p className="text-zinc-300 text-xs sm:text-sm mb-5 sm:mb-6 max-w-[200px]">Collect $RUN tokens while dodging red candles.</p>
            <button 
              onClick={(e) => { e.stopPropagation(); resetGame(); }}
              className="bg-white text-black px-6 py-2.5 sm:px-6 sm:py-3 rounded-full font-bold text-xs sm:text-sm uppercase tracking-wider hover:bg-zinc-200 transition-colors shadow-[0_0_20px_rgba(255,255,255,0.2)]"
            >
              Start Earning
            </button>
          </div>
        )}

        {/* Game Over Screen Overlay */}
        {gameState === 'GAME_OVER' && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center p-4 sm:p-6 text-center">
            <h2 className="text-2xl sm:text-3xl font-black text-red-500 mb-1 uppercase tracking-widest drop-shadow-lg">REKT</h2>
            
            <div className="bg-zinc-900 border border-zinc-800 p-3 sm:p-4 rounded-xl shadow-xl mb-5 sm:mb-6 w-full max-w-[200px] sm:max-w-[240px]">
              <div className="text-zinc-400 text-[10px] sm:text-xs font-bold uppercase mb-1">Session Earnings</div>
              <div className="flex items-center justify-center gap-2">
                <span className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-yellow-300 to-yellow-500 bg-clip-text text-transparent font-mono">+{score}</span>
                <span className="text-yellow-500 text-xs sm:text-sm font-bold">$RUN</span>
              </div>
              <div className="text-green-400 text-[10px] sm:text-xs mt-2 font-medium bg-green-950/30 py-1 rounded inline-block px-2 border border-green-900/50">
                Added to Wallet
              </div>
            </div>

            <button 
              onClick={(e) => { e.stopPropagation(); resetGame(); }}
              className="flex items-center gap-2 bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-6 py-2.5 sm:px-8 sm:py-3.5 rounded-full font-bold text-xs sm:text-sm uppercase tracking-wide hover:brightness-110 transition-all shadow-[0_0_20px_rgba(14,165,233,0.4)] hover:scale-105 active:scale-95"
            >
              <RotateCcw className="w-4 h-4" />
              Play Again
            </button>
          </div>
        )}
      </div>

      <div className="mt-8 flex flex-col items-center text-center">
        <p className="text-zinc-500 text-sm font-medium mb-1 flex items-center">
           Tap screen or hit <kbd className="bg-zinc-800 border border-zinc-700 px-2 py-0.5 rounded text-zinc-300 mx-1 ml-2 font-mono text-xs shadow-inner">SPACE</kbd> to jump
        </p>
      </div>
    </div>
  );
}

function SpinView({ onReward }: GameProps) {
  const PRIZES = [500, 1000, 20, 100, 50, 250];
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [lastSpin, setLastSpin] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState<string>('');

  useEffect(() => {
    const stored = localStorage.getItem('last_spin_time');
    if (stored) setLastSpin(parseInt(stored, 10));
  }, []);

  useEffect(() => {
    if (!lastSpin) {
      setTimeLeft('');
      return;
    }
    const interval = setInterval(() => {
       const now = Date.now();
       const nextSpin = lastSpin + (24 * 60 * 60 * 1000); // 24 hours
       const diff = nextSpin - now;

       if (diff <= 0) {
         setLastSpin(null);
         localStorage.removeItem('last_spin_time');
         setTimeLeft('');
       } else {
         const h = Math.floor(diff / (1000 * 60 * 60));
         const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
         const s = Math.floor((diff % (1000 * 60)) / 1000);
         setTimeLeft(`${h}h ${m}m ${s}s`);
       }
    }, 1000);
    return () => clearInterval(interval);
  }, [lastSpin]);

  const handleSpin = () => {
    if (lastSpin || spinning) return;
    setSpinning(true);

    const targetIndex = Math.floor(Math.random() * PRIZES.length);
    const prize = PRIZES[targetIndex];

    const currentMod = rotation % 360;
    const segmentDegree = 360 / PRIZES.length; // 60
    
    // Calculate rotation to make the target segment point exactly UP.
    // Segment 0 is natively pointing UP because we rotate the inner text elements.
    const targetMod = (360 - targetIndex * segmentDegree) % 360;
    
    let spinDiff = targetMod - currentMod;
    if (spinDiff < 0) spinDiff += 360;
    
    // Add 5 full rotations + to the target segment + random variance logic
    const totalSpin = (360 * 6) + spinDiff + (Math.random() * 40 - 20);
    
    setRotation(r => r + totalSpin);

    setTimeout(() => {
      onReward(prize);
      const now = Date.now();
      setLastSpin(now);
      localStorage.setItem('last_spin_time', now.toString());
      setSpinning(false);
    }, 4000);
  };

  return (
    <div className="flex flex-col items-center justify-center p-6 h-full">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-black text-white uppercase tracking-tight flex items-center justify-center mb-2">
           <Gift className="text-fuchsia-500 mr-2" /> Daily Spin
        </h2>
        <p className="text-zinc-400 text-sm">Every 24 hours, spin the wheel to multiply your $RUN token holdings.</p>
      </div>

      <div className="relative w-72 h-72 sm:w-80 sm:h-80 mx-auto rounded-full border-[6px] border-zinc-800 shadow-[0_0_40px_rgba(217,70,239,0.15)] ring-1 ring-white/5 bg-zinc-900 mb-10 shrink-0">
        
        {/* Wheel body */}
        <div 
          className="w-full h-full rounded-full relative overflow-hidden transition-[transform] duration-[4000ms] ease-[cubic-bezier(0.1,0.9,0.2,1)]"
          style={{ transform: `rotate(${rotation}deg)` }}
        >
          {/* Conic Gradient for slices */}
          <div className="absolute inset-0 z-0"
            style={{
              background: `conic-gradient(from -30deg,
                #8b5cf6 0deg 60deg,
                #ec4899 60deg 120deg,
                #ef4444 120deg 180deg,
                #eab308 180deg 240deg,
                #22c55e 240deg 300deg,
                #0ea5e9 300deg 360deg
              )`
            }}
          />
          
          {/* Slice Texts */}
          {PRIZES.map((prize, i) => {
            const rotationDeg = i * (360 / PRIZES.length);
            return (
              <div 
                key={i}
                className="absolute w-full h-full left-0 top-0 flex items-start justify-center text-white font-black text-2xl pt-6 sm:pt-8 drop-shadow-md z-10"
                style={{ transform: `rotate(${rotationDeg}deg)` }}
              >
                <span>{prize}</span>
              </div>
            );
          })}
          
          {/* Inner center ring */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 bg-zinc-900 rounded-full border-4 border-zinc-700 shadow-inner z-20 flex items-center justify-center">
            <span className="text-zinc-400 font-bold text-lg">$</span>
          </div>
        </div>

        {/* The pointer at top center */}
        <div className="absolute -top-4 left-1/2 -translate-x-1/2 w-8 h-10 drop-shadow-[0_4px_10px_rgba(0,0,0,0.5)] z-30">
          <svg viewBox="0 0 24 24" fill="white" className="w-8 h-10">
            <path d="M12 24L0 0H24L12 24Z" />
          </svg>
        </div>
      </div>

      <div className="w-full max-w-xs space-y-4">
        {lastSpin ? (
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-4 text-center">
            <div className="flex items-center justify-center gap-2 text-zinc-400 mb-1">
              <Clock className="w-4 h-4" />
              <span className="text-xs font-semibold uppercase tracking-wider">Next spin in</span>
            </div>
            <div className="text-2xl font-mono font-bold text-white tracking-widest">{timeLeft}</div>
          </div>
        ) : (
          <button 
            onClick={handleSpin}
            disabled={spinning}
            className="w-full bg-gradient-to-r from-fuchsia-600 to-purple-600 hover:from-fuchsia-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-4 rounded-2xl font-black text-lg uppercase tracking-widest transition-all shadow-[0_0_20px_rgba(192,38,211,0.4)] flex justify-between items-center group active:scale-95"
          >
            {spinning ? 'Spinning...' : 'Spin Now'}
            <ChevronRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
          </button>
        )}
      </div>
    </div>
  );
}

function LeaderboardView() {
  const [leaders, setLeaders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [userAuth, setUserAuth] = useState(auth.currentUser);

  useEffect(() => {
    const unsubscribeAuth = auth.onAuthStateChanged(user => {
      setUserAuth(user);
    });

    const q = query(
      collection(db, 'leaderboard'),
      orderBy('highScore', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const topScores = snapshot.docs.map((doc, index) => ({
        id: doc.id,
        rank: index + 1,
        ...doc.data()
      }));
      setLeaders(topScores);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'leaderboard');
      setLoading(false);
    });

    return () => {
      unsubscribe();
      unsubscribeAuth();
    };
  }, []);

  return (
    <div className="flex flex-col p-6 h-full text-white">
      <div className="text-center mb-6 shrink-0 mt-2">
        <h2 className="text-2xl font-black uppercase tracking-tight flex items-center justify-center mb-1">
           <Trophy className="text-yellow-500 mr-2 w-6 h-6" /> Top 50 Runners
        </h2>
        <p className="text-zinc-400 text-xs">Highest earners in the network.</p>
        {!userAuth && (
          <button 
            onClick={() => signInWithGoogle()}
            className="mt-4 bg-white text-black px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-zinc-200 transition-colors shadow-lg"
          >
            Sign in with Google to save score
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar pb-8 relative rounded-xl border border-zinc-800 bg-zinc-900/50 shadow-inner">
        {loading ? (
          <div className="flex justify-center items-center h-40">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
          </div>
        ) : leaders.length === 0 ? (
          <div className="flex flex-col justify-center items-center h-40 text-zinc-500">
            <Users className="w-10 h-10 mb-2 opacity-50" />
            <p className="text-sm font-semibold">No runners yet. Be the first!</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/80">
            {leaders.map((leader) => (
              <div 
                key={leader.id} 
                className={`flex items-center px-4 py-3 transition-colors ${
                  leader.id === auth.currentUser?.uid ? 'bg-cyan-950/30 border-l-2 border-cyan-500' : 'hover:bg-zinc-800/50'
                }`}
              >
                <div className="w-8 shrink-0 flex justify-center">
                  {leader.rank === 1 ? (
                    <Trophy className="w-5 h-5 text-yellow-400" />
                  ) : leader.rank === 2 ? (
                     <Trophy className="w-5 h-5 text-zinc-300" />
                  ) : leader.rank === 3 ? (
                     <Trophy className="w-5 h-5 text-amber-700" />
                  ) : (
                    <span className="font-mono text-zinc-500 font-bold text-sm">#{leader.rank}</span>
                  )}
                </div>
                
                <div className="flex-1 min-w-0 px-3">
                   <div className="flex items-center gap-2">
                     <span className={`font-bold truncate text-sm ${leader.id === auth.currentUser?.uid ? 'text-cyan-400' : 'text-zinc-200'}`}>
                       {leader.username}
                     </span>
                     {leader.id === auth.currentUser?.uid && (
                       <span className="bg-cyan-900 text-cyan-300 text-[9px] uppercase font-black px-1.5 py-0.5 rounded">You</span>
                     )}
                   </div>
                </div>

                <div className="shrink-0 flex items-center justify-end">
                  <span className="font-mono font-bold text-yellow-500 text-sm">{leader.highScore}</span>
                  <span className="text-[10px] text-zinc-600 ml-1 font-bold">RUN</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TasksView({ onReward }: GameProps) {
  const [telegramDone, setTelegramDone] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const done = localStorage.getItem('task_telegram_completed');
    if (done === 'true') {
      setTelegramDone(true);
    }
  }, []);

  const handleTelegramTask = () => {
    if (telegramDone || checking) return;
    
    // Attempt to open link, if in Telegram Web App:
    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink('https://t.me/neonrunearn');
    } else {
      window.open('https://t.me/neonrunearn', '_blank');
    }

    setChecking(true);
    
    // Simulate checking delay
    setTimeout(() => {
      onReward(100);
      setTelegramDone(true);
      localStorage.setItem('task_telegram_completed', 'true');
      setChecking(false);
    }, 2000);
  };

  return (
    <div className="flex flex-col p-6 h-full text-white">
      <div className="text-center mb-6 shrink-0 mt-2">
        <h2 className="text-2xl font-black uppercase tracking-tight flex items-center justify-center mb-1">
           <ListTodo className="text-emerald-400 mr-2 w-6 h-6" /> Tasks
        </h2>
        <p className="text-zinc-400 text-xs">Complete simple tasks to earn more $RUN.</p>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar space-y-3">
        {/* Telegram Task */}
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-4 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <div className="bg-blue-500/10 p-2 rounded-xl text-blue-400 border border-blue-500/20">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
                 <path d="M21 5L2 12.5l7 2.5 9-8.5-7.5 9.5 5.5 4 4-15z" />
               </svg>
            </div>
            <div>
              <div className="font-bold text-sm">Join our Telegram</div>
              <div className="text-xs text-zinc-500 font-medium">+100 $RUN</div>
            </div>
          </div>

          <div>
            {telegramDone ? (
              <div className="flex items-center gap-1 text-emerald-400 bg-emerald-400/10 px-3 py-1.5 rounded-lg border border-emerald-400/20">
                <CheckCircle2 className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-wider">Done</span>
              </div>
            ) : (
              <button 
                onClick={handleTelegramTask}
                disabled={checking}
                className="bg-white text-black px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-zinc-200 transition-colors disabled:opacity-50 min-w-[80px]"
              >
                {checking ? 'Checking' : 'Start'}
              </button>
            )}
          </div>
        </div>

        {/* Placeholder for future tasks */}
        <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-2xl p-4 flex items-center justify-between opacity-60">
           <div className="flex items-center gap-3">
            <div className="bg-zinc-800 p-2 rounded-xl text-zinc-500">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" /></svg>
            </div>
            <div>
              <div className="font-bold text-sm">More coming soon</div>
              <div className="text-xs text-zinc-500 font-medium">Follow other socials</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WithdrawView({ walletBalance, usdValue }: { walletBalance: number, usdValue: string }) {
  const progress = Math.min((parseFloat(usdValue) / 50) * 100, 100);
  
  return (
    <div className="flex flex-col p-6 h-full text-white">
      <div className="text-center mb-6 shrink-0 mt-2">
        <h2 className="text-2xl font-black uppercase tracking-tight flex items-center justify-center mb-1">
           <CreditCard className="text-blue-400 mr-2 w-6 h-6" /> Withdraw
        </h2>
        <p className="text-zinc-400 text-xs">Convert $RUN to real cash.</p>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar space-y-4">
        
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-6 text-center shadow-sm">
          <div className="text-sm text-zinc-400 mb-2 font-semibold uppercase tracking-wider">Current Balance</div>
          <div className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 to-yellow-500 mb-1 font-mono">
            {walletBalance.toLocaleString()}
          </div>
          <div className="text-sm font-mono text-zinc-500 mb-8">≈ ${usdValue} USD</div>

          <div className="text-left mb-2 flex justify-between text-[11px] font-bold text-zinc-400 uppercase tracking-wider px-1">
            <span>Progress to $50</span>
            <span className="text-blue-400">{progress.toFixed(1)}%</span>
          </div>
          <div className="w-full bg-zinc-800/80 rounded-full h-4 mb-8 overflow-hidden border border-zinc-700 relative">
            <div className="bg-gradient-to-r from-blue-500 to-cyan-400 h-full rounded-full transition-all duration-1000 ease-out relative z-10" style={{ width: `${progress}%` }}></div>
          </div>
          
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-5 mb-6 text-center shadow-inner relative overflow-hidden">
             <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-cyan-400 opacity-50"></div>
            <h3 className="text-blue-400 font-black mb-2 uppercase tracking-wide text-sm flex items-center justify-center gap-2">
              <Clock className="w-4 h-4" /> Coming Soon
            </h3>
            <p className="text-xs text-blue-200/80 leading-relaxed font-medium">
              Withdrawals are being processed for the next major network upgrade. Keep playing, finish tasks, and stack your $RUN tokens! 
            </p>
          </div>

          <button 
            disabled
            className="w-full bg-zinc-800 text-zinc-500 px-6 py-4 rounded-xl font-black text-xs uppercase tracking-widest cursor-not-allowed border border-zinc-700/50 shadow-inner"
          >
            {parseFloat(usdValue) < 50 ? 'Minimum $50 required' : 'Withdrawals Updating'}
          </button>
        </div>

      </div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<'GAME' | 'SPIN' | 'LEADERBOARD' | 'TASKS' | 'WITHDRAW'>('GAME');
  const [walletBalance, setWalletBalance] = useState(0);

  useEffect(() => {
    const saved = localStorage.getItem('wallet_balance');
    if (saved) setWalletBalance(parseInt(saved, 10));
  }, []);

  const addFunds = useCallback((amount: number) => {
    setWalletBalance(prev => {
      const newBal = prev + amount;
      localStorage.setItem('wallet_balance', newBal.toString());
      return newBal;
    });
  }, []);

  // Adjust exchange rate to be realistic for a clicker game ($0.0001 per RUN token)
  const usdValue = (walletBalance * 0.0001).toFixed(4);

  return (
    <div className="min-h-screen bg-black text-zinc-100 flex justify-center font-sans select-none overflow-hidden h-[100dvh]">
      
      {/* Mobile App Container */}
      <div className="w-full max-w-md bg-zinc-950 flex flex-col h-full relative border-x border-zinc-900/50 shadow-2xl">
        
        {/* Universal Top Header: The Wallet */}
        <div className="h-20 shrink-0 flex items-center justify-between px-5 bg-zinc-900/80 backdrop-blur border-b border-zinc-800/80 z-20">
          <div className="flex flex-col">
             <div className="font-bold text-xs uppercase tracking-widest text-zinc-500 mb-0.5">My Wallet</div>
             <div className="font-bold text-2xl flex items-center -ml-1">
               <span className="text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 to-yellow-500 tracking-tight ml-1 mr-2 tabular-nums">
                 {walletBalance.toLocaleString()}
               </span>
               <span className="text-sm font-black uppercase text-yellow-500/80 bg-yellow-500/10 px-2 py-0.5 rounded border border-yellow-500/20">
                 $RUN
               </span>
             </div>
             <div className="text-zinc-500 font-mono text-[10px] tracking-widest mt-0.5">≈ ${usdValue} USD</div>
          </div>
          
          <div className="bg-zinc-950 p-2.5 rounded-full border border-zinc-800 text-cyan-400">
            <Wallet className="w-6 h-6" />
          </div>
        </div>

        {/* Dynamic Inner Content */}
        <div className="flex-1 overflow-y-auto no-scrollbar relative min-h-0">
          <div className="absolute inset-0 pb-10">
             {view === 'GAME' && <GameView onReward={addFunds} />}
             {view === 'SPIN' && <SpinView onReward={addFunds} />}
             {view === 'LEADERBOARD' && <LeaderboardView />}
             {view === 'TASKS' && <TasksView onReward={addFunds} />}
             {view === 'WITHDRAW' && <WithdrawView walletBalance={walletBalance} usdValue={usdValue} />}
          </div>
        </div>

        {/* Bottom Tab Navigation */}
        <div className="h-20 shrink-0 bg-zinc-950 border-t border-zinc-800/80 flex items-center justify-around pb-safe z-20 px-1">
          
          <button 
            onClick={() => setView('GAME')}
            className={`flex flex-col items-center justify-center w-full h-full gap-1 transition-colors ${view === 'GAME' ? 'text-cyan-400' : 'text-zinc-500 hover:text-zinc-400'}`}
          >
            <Gamepad2 className={`w-5 h-5 sm:w-6 sm:h-6 ${view === 'GAME' ? 'drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]' : ''}`} />
            <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest truncate">Play</span>
          </button>
          
          <button 
            onClick={() => setView('TASKS')}
            className={`flex flex-col items-center justify-center w-full h-full gap-1 transition-colors ${view === 'TASKS' ? 'text-emerald-400' : 'text-zinc-500 hover:text-zinc-400'}`}
          >
            <ListTodo className={`w-5 h-5 sm:w-6 sm:h-6 ${view === 'TASKS' ? 'drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]' : ''}`} />
            <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest truncate">Tasks</span>
          </button>

          <button 
            onClick={() => setView('SPIN')}
            className={`flex flex-col items-center justify-center w-full h-full gap-1 transition-colors ${view === 'SPIN' ? 'text-fuchsia-500' : 'text-zinc-500 hover:text-zinc-400'}`}
          >
            <RotateCcw className={`w-5 h-5 sm:w-6 sm:h-6 ${view === 'SPIN' ? 'drop-shadow-[0_0_8px_rgba(217,70,239,0.5)]' : ''}`} />
            <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest truncate">Spin</span>
          </button>

          <button 
            onClick={() => setView('WITHDRAW')}
            className={`flex flex-col items-center justify-center w-full h-full gap-1 transition-colors ${view === 'WITHDRAW' ? 'text-blue-400' : 'text-zinc-500 hover:text-zinc-400'}`}
          >
            <CreditCard className={`w-5 h-5 sm:w-6 sm:h-6 ${view === 'WITHDRAW' ? 'drop-shadow-[0_0_8px_rgba(96,165,250,0.5)]' : ''}`} />
            <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest truncate">Draw</span>
          </button>

          <button 
            onClick={() => setView('LEADERBOARD')}
            className={`flex flex-col items-center justify-center w-full h-full gap-1 transition-colors ${view === 'LEADERBOARD' ? 'text-yellow-400' : 'text-zinc-500 hover:text-zinc-400'}`}
          >
            <Trophy className={`w-5 h-5 sm:w-6 sm:h-6 ${view === 'LEADERBOARD' ? 'drop-shadow-[0_0_8px_rgba(250,204,21,0.5)]' : ''}`} />
            <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest truncate">Ranks</span>
          </button>

        </div>

      </div>
    </div>
  );
}
