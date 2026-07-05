import { memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { ArrowRight, FolderOpen } from "lucide-react";
import {
  getContinueMessage,
  getNextContinueMessageDelay,
  shouldRefreshContinueMessage,
  type ContinueMessage,
} from "@/lib/welcome-screen";
import { projectSidebarArrowX } from "@/lib/welcome-screen-arrow";

// ── Constants ─────────────────────────────────────────────────────────

const EASE_OUT: [number, number, number, number] = [0.22, 0.68, 0, 1];
const DISPLAY_FONT = "'Instrument Serif', Georgia, serif";
const SIDEBAR_ARROW_HEIGHT = 360;
const SIDEBAR_ARROW_TIP_INSET = 18;
const SIDEBAR_ARROW_RIGHT_INSET = 24;
const SIDEBAR_ARROW_BASE_SPAN = 642;
const SIDEBAR_ARROW_MAX_OFFSET = 772;
const SIDEBAR_ARROW_TAIL_GAP = 36;
const SIDEBAR_ARROW_HEAD_LENGTH = 34;
const SIDEBAR_ARROW_HEAD_SPREAD = 19;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function rotateVector(x: number, y: number, radians: number) {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  };
}

// ── Ambient Background ───────────────────────────────────────────────

function AmbientBackground({ accent }: { accent?: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Central accent halo — slow breathe tied to the greeting's mood color */}
      <motion.div
        className="absolute top-1/2 left-1/2 h-[70%] w-[60%] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background: accent
            ? `radial-gradient(ellipse 50% 50% at 50% 50%, ${accent} 0%, transparent 70%)`
            : "radial-gradient(ellipse 50% 50% at 50% 50%, var(--foreground) 0%, transparent 70%)",
          opacity: 0.06,
        }}
        animate={{ scale: [1, 1.08, 1], opacity: [0.06, 0.08, 0.06] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Drifting orb — top-right, very faint */}
      <motion.div
        className="absolute -top-[15%] -right-[10%] h-[45%] w-[40%] rounded-full opacity-[0.025] blur-[140px]"
        style={{ background: "radial-gradient(circle, var(--foreground) 0%, transparent 70%)" }}
        animate={{ x: [0, -20, 10, 0], y: [0, 15, -10, 0] }}
        transition={{ duration: 40, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

// ── Noise Grain Overlay ───────────────────────────────────────────────

function GrainOverlay() {
  return (
    <div
      className="pointer-events-none absolute inset-0 opacity-[0.015] mix-blend-overlay"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        backgroundRepeat: "repeat",
        backgroundSize: "128px 128px",
      }}
    />
  );
}

function PccAgentMark() {
  return (
    <img
      src="icon.png"
      alt="PccAgent"
      className="h-12 w-12 shrink-0 object-contain sm:h-14 sm:w-14 lg:h-16 lg:w-16"
      draggable={false}
    />
  );
}

// ── Sidebar Arrow — absolutely positioned from left edge to center ─────

/** Sweeping hand-drawn arrow that stretches from the left edge of the chat
 *  panel (the sidebar boundary) to roughly center-screen where the title sits.
 *  Placed as a direct child of the outer `relative` container so the arrow
 *  tip can sit on the sidebar boundary while the tail starts beneath the
 *  centered caption. */
interface SidebarArrowProps {
  anchorElement: HTMLElement | null;
}

function SidebarArrow({ anchorElement }: SidebarArrowProps) {
  const { t } = useTranslation("welcome");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [metrics, setMetrics] = useState<{ svgWidth: number; tailX: number; labelTop: number | null }>({
    svgWidth: 900,
    tailX: 660,
    labelTop: null,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !anchorElement) {
      return;
    }

    const updateMetrics = () => {
      const containerRect = container.getBoundingClientRect();
      const anchorRect = anchorElement.getBoundingClientRect();
      const parentRect = container.offsetParent instanceof HTMLElement
        ? container.offsetParent.getBoundingClientRect()
        : containerRect;
      const nextWidth = Math.max(containerRect.width, 1);
      const maxTailX = Math.max(nextWidth - 24, SIDEBAR_ARROW_TIP_INSET + 120);
      const minTailX = Math.min(660, maxTailX);
      const anchoredTailX =
        anchorRect.right - containerRect.left + SIDEBAR_ARROW_TAIL_GAP;
      const nextTailX = clamp(anchoredTailX, minTailX, maxTailX);
      const nextLabelTop = anchorRect.bottom - parentRect.top + 14;

      setMetrics((prevMetrics) => {
        const widthChanged = Math.abs(prevMetrics.svgWidth - nextWidth) >= 1;
        const tailChanged = Math.abs(prevMetrics.tailX - nextTailX) >= 1;
        const labelChanged = prevMetrics.labelTop === null || Math.abs(prevMetrics.labelTop - nextLabelTop) >= 1;
        if (!widthChanged && !tailChanged && !labelChanged) {
          return prevMetrics;
        }
        return { svgWidth: nextWidth, tailX: nextTailX, labelTop: nextLabelTop };
      });
    };

    updateMetrics();

    const observer = new ResizeObserver(() => {
      updateMetrics();
    });

    observer.observe(container);
    observer.observe(anchorElement);

    const fontReady = document.fonts?.ready;
    if (fontReady) {
      void fontReady.then(() => {
        updateMetrics();
      });
    }

    const handleVisibilityOrFocus = () => {
      if (!document.hidden) {
        updateMetrics();
      }
    };

    window.addEventListener("resize", updateMetrics);
    window.addEventListener("focus", handleVisibilityOrFocus);
    document.addEventListener("visibilitychange", handleVisibilityOrFocus);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateMetrics);
      window.removeEventListener("focus", handleVisibilityOrFocus);
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
    };
  }, [anchorElement]);

  const usableWidth = Math.max(metrics.svgWidth, 1);
  const tipX = SIDEBAR_ARROW_TIP_INSET;
  const tailX = metrics.tailX;
  const span = Math.max(tailX - tipX, 1);
  const scaleX = (offset: number) =>
    projectSidebarArrowX({
      offset,
      tipX,
      tailX,
      usableWidth,
      baseSpan: SIDEBAR_ARROW_BASE_SPAN,
      maxOffset: SIDEBAR_ARROW_MAX_OFFSET,
      rightInset: SIDEBAR_ARROW_RIGHT_INSET,
    });
  const endPoint = { x: tipX, y: 18 };
  const endControlPoint = { x: scaleX(92), y: 136 };

  // Keep the tip pinned near the sidebar while the sweep length expands.
  const curvePath = [
    `M ${tailX.toFixed(2)} 104`,
    `C ${scaleX(742).toFixed(2)} 122, ${scaleX(772).toFixed(2)} 235, ${scaleX(702).toFixed(2)} 272`,
    `C ${scaleX(617).toFixed(2)} 318, ${scaleX(452).toFixed(2)} 312, ${scaleX(312).toFixed(2)} 258`,
    `C ${scaleX(192).toFixed(2)} 212, ${endControlPoint.x.toFixed(2)} 136, ${endPoint.x} ${endPoint.y}`,
  ].join(" ");

  const tangentX = endPoint.x - endControlPoint.x;
  const tangentY = endPoint.y - endControlPoint.y;
  const tangentLength = Math.hypot(tangentX, tangentY) || 1;
  const unitTangentX = tangentX / tangentLength;
  const unitTangentY = tangentY / tangentLength;
  const headLength = clamp(span * 0.055, SIDEBAR_ARROW_HEAD_LENGTH, 48);
  const headSpread = clamp(headLength * 0.56, SIDEBAR_ARROW_HEAD_SPREAD, 26);
  const baseCenter = {
    x: endPoint.x - unitTangentX * headLength,
    y: endPoint.y - unitTangentY * headLength,
  };
  const upperWingDirection = rotateVector(unitTangentX, unitTangentY, Math.PI / 2);
  const lowerWingDirection = rotateVector(unitTangentX, unitTangentY, -Math.PI / 2);
  const upperWing = {
    x: baseCenter.x + upperWingDirection.x * headSpread,
    y: baseCenter.y + upperWingDirection.y * headSpread,
  };
  const lowerWing = {
    x: baseCenter.x + lowerWingDirection.x * headSpread,
    y: baseCenter.y + lowerWingDirection.y * headSpread,
  };
  const arrowHead = [
    `M ${upperWing.x.toFixed(2)} ${upperWing.y.toFixed(2)}`,
    `L ${endPoint.x} ${endPoint.y}`,
    `L ${lowerWing.x.toFixed(2)} ${lowerWing.y.toFixed(2)}`,
  ].join(" ");

  return (
    <>
      {/* Label */}
      <motion.div
        className="pointer-events-none absolute left-0 z-[3] w-full text-center"
        style={{ top: metrics.labelTop ?? "calc(50% + 84px)" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.6, duration: 0.4 }}
      >
        <span
          className="italic text-foreground/[0.16]"
          style={{ fontFamily: DISPLAY_FONT, fontSize: "17px" }}
        >
          {t("screen.sidebarHint")}
        </span>
      </motion.div>

      {/* Arrow */}
      <motion.div
        ref={containerRef}
        className="pointer-events-none absolute inset-x-0 z-[2] h-[360px]"
        style={{ top: "calc(50% - 42px)" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.4 }}
      >
        <svg
          viewBox={`0 0 ${usableWidth} ${SIDEBAR_ARROW_HEIGHT}`}
          preserveAspectRatio="none"
          fill="none"
          className="h-full w-full text-foreground/[0.16]"
        >
          <motion.path
            d={curvePath}
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            fill="none"
            vectorEffect="non-scaling-stroke"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ delay: 0.7, duration: 1.2, ease: [0.4, 0, 0.2, 1] }}
          />
          <motion.path
            d={arrowHead}
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            vectorEffect="non-scaling-stroke"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.85, duration: 0.2 }}
          />
        </svg>
      </motion.div>
    </>
  );
}

// ── Main Component ────────────────────────────────────────────────────

interface WelcomeScreenProps {
  hasProjects: boolean;
  onCreateProject: () => void;
}

export const WelcomeScreen = memo(function WelcomeScreen({
  hasProjects,
  onCreateProject,
}: WelcomeScreenProps) {
  const { t } = useTranslation("welcome");
  const [subtitleElement, setSubtitleElement] = useState<HTMLParagraphElement | null>(null);
  const [continueMessage, setContinueMessage] = useState<ContinueMessage>(() =>
    getContinueMessage(),
  );
  const lastRefreshAtRef = useRef(new Date());

  useEffect(() => {
    if (!hasProjects) {
      return;
    }

    let refreshTimer: number | null = null;

    function refreshMessage(now: Date) {
      lastRefreshAtRef.current = now;
      setContinueMessage((previous) => getContinueMessage(previous, now));
    }

    function queueNextRefresh() {
      const delay = getNextContinueMessageDelay();
      refreshTimer = window.setTimeout(() => {
        refreshMessage(new Date());
        queueNextRefresh();
      }, delay);
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        return;
      }

      const now = new Date();
      if (!shouldRefreshContinueMessage(lastRefreshAtRef.current, now)) {
        return;
      }

      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      refreshMessage(now);
      queueNextRefresh();
    }

    queueNextRefresh();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [hasProjects]);

  // --- No projects state ---
  if (!hasProjects) {
    return (
      <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden">
        <AmbientBackground />
        <GrainOverlay />

        <motion.div
          className="relative z-10 flex flex-col items-center gap-8 px-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE_OUT }}
        >
          <motion.div
            className="flex flex-col items-center gap-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.5 }}
          >
            <PccAgentMark />
            <h1
              className="text-center text-4xl italic text-foreground sm:text-5xl"
              style={{ fontFamily: DISPLAY_FONT }}
            >
              {t("screen.openProject")}
            </h1>
            <p className="max-w-[300px] text-center text-base leading-relaxed text-muted-foreground">
              {t("screen.openProjectSubtitle")}
            </p>
          </motion.div>

          <motion.button
            onClick={onCreateProject}
            className="group flex items-center gap-2.5 rounded-full bg-foreground px-8 py-3.5 text-base font-semibold text-background transition-opacity hover:opacity-85"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            <FolderOpen className="h-4 w-4" />
            {t("screen.chooseFolder")}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </motion.button>
        </motion.div>
      </div>
    );
  }

  // --- Has projects, no active session ---
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      {/* Hand-drawn arrow from center to sidebar edge */}
      <SidebarArrow anchorElement={subtitleElement} />

      {/* Central content */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6">
        <motion.div
          className="flex flex-col items-center gap-6"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE_OUT }}
        >
          {/* Headline */}
          <motion.div
            className="flex flex-col items-center gap-3 sm:gap-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.5 }}
          >
            <PccAgentMark />
            <motion.h1
              key={continueMessage.headline}
              className="text-center text-4xl italic text-foreground sm:text-5xl"
              style={{ fontFamily: DISPLAY_FONT }}
              initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 0.45, ease: EASE_OUT }}
            >
              {continueMessage.headline}
            </motion.h1>
            <motion.p
              key={continueMessage.subtitle}
              ref={setSubtitleElement}
              className="max-w-[min(92vw,640px)] text-center text-base leading-relaxed text-muted-foreground"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.05, ease: EASE_OUT }}
            >
              {continueMessage.subtitle}
            </motion.p>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
});
