import { useRef, useCallback } from 'react';

interface SoundEffects {
  click: string;
  win: string;
  loss: string;
}

const SOUND_PATHS: SoundEffects = {
  click: '/sfx/Button Click - Sound Effect.mp3',
  win: '/sfx/Cash Register Cha-Ching _ Sound Effect _ (Kaching) - Sound - HD.mp3',
  loss: '/sfx/loss.mp3',
};

export function useSoundEffects() {
  const audioCache = useRef<Map<string, HTMLAudioElement>>(new Map());
  const isMuted = useRef(false);

  const loadSound = useCallback((path: string) => {
    if (!audioCache.current.has(path)) {
      const audio = new Audio(path);
      audio.preload = 'auto';
      audioCache.current.set(path, audio);
    }
    return audioCache.current.get(path)!;
  }, []);

  const playSound = useCallback((soundType: keyof SoundEffects, volume: number = 0.5, startTime?: number, endTime?: number) => {
    if (isMuted.current) return;

    try {
      const path = SOUND_PATHS[soundType];
      const audio = loadSound(path);
      
      // Clone the audio to allow overlapping sounds
      const soundClone = audio.cloneNode() as HTMLAudioElement;
      soundClone.volume = volume;
      
      // If start/end times provided, use them
      if (startTime !== undefined) {
        soundClone.currentTime = startTime;
        
        if (endTime !== undefined) {
          // Stop playback at end time
          const duration = endTime - startTime;
          setTimeout(() => {
            soundClone.pause();
            soundClone.currentTime = 0;
          }, duration * 1000);
        }
      }
      
      soundClone.play().catch((error) => {
        console.warn(`Failed to play ${soundType} sound:`, error);
      });
    } catch (error) {
      console.warn(`Error playing ${soundType} sound:`, error);
    }
  }, [loadSound]);

  const toggleMute = useCallback(() => {
    isMuted.current = !isMuted.current;
    return isMuted.current;
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    isMuted.current = muted;
  }, []);

  return {
    playClick: () => playSound('click', 0.3, 0, 1), // Play from 0:00 to 0:01 (1 second)
    playWin: () => playSound('win', 0.6),
    playLoss: () => playSound('loss', 0.5), // Play full sound at higher volume
    toggleMute,
    setMuted,
  };
}

