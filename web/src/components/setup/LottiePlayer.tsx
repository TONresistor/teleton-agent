import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import lottie from 'lottie-web/build/player/lottie_light';

interface LottiePlayerProps {
  animationData: object;
  loop?: boolean;
  style?: CSSProperties;
}

export default function LottiePlayer({ animationData, loop = false, style }: LottiePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const animation = lottie.loadAnimation({
      container: containerRef.current,
      renderer: 'svg',
      loop,
      autoplay: true,
      animationData,
    });

    return () => animation.destroy();
  }, [animationData, loop]);

  return <div ref={containerRef} style={style} aria-hidden="true" />;
}
