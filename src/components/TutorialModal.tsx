'use client';

import styles from './TutorialModal.module.css';

interface TutorialModalProps {
  isOpen: boolean;
  onComplete: () => void;
}

export default function TutorialModal({ isOpen, onComplete }: TutorialModalProps) {
  if (!isOpen) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <p className={styles.welcomeText}>welcome to</p>
          <h1 className={styles.title}>MERCURY</h1>
        </div>

        <div className={styles.content}>
          <div className={styles.videoSection}>
            <div className={styles.videoPlaceholder}>
              {/* Video will be added later */}
            </div>
            <div className={styles.progressIndicators}>
              <div className={`${styles.indicator} ${styles.active}`} />
              <div className={styles.indicator} />
              <div className={styles.indicator} />
            </div>
          </div>

          <div className={styles.tipsSection}>
            <div className={styles.tip}>
              <svg className={styles.icon} width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path
                  d="M15.1875 3.9375L6.9375 12.1875L3.9375 9.1875"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className={styles.tipLabel}>single tap :</span>
              <p className={styles.tipDescription}>
                Place orders by tapping on the block, this creates a binary order with desired
                expiry and predetermined amount
              </p>
            </div>

            <div className={styles.tip}>
              <svg className={styles.icon} width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path
                  d="M2 2H16V16H2V2Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M2 6H16M2 10H16M6 2V16M10 2V16"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M11 11L13 13"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              <span className={styles.tipLabel}>click &amp; drag:</span>
              <p className={styles.tipDescription}>
                M + click and drag to select multiple grids* and place multiple orders, double click
                the selection to confirm
              </p>
            </div>
          </div>
        </div>

        <button className={styles.startBtn} onClick={onComplete}>
          Start Trading
          <svg width="18" height="16" viewBox="0 0 18 16" fill="none">
            <path
              d="M1 8H17M17 8L10 1M17 8L10 15"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

