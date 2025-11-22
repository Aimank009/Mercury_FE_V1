'use client';

import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import styles from './TermsModal.module.css';
import { pad } from 'viem';

interface TermsModalProps {
  isOpen: boolean;
  onAccept: () => void;
  onClose: () => void;
}

export default function TermsModal({ isOpen, onAccept, onClose }: TermsModalProps) {
  const [checks, setChecks] = useState({
    termsAndPrivacy: false,
    cookiePolicy: false,
    enableTrading: false,
  });

  const allChecked = Object.values(checks).every((v) => v);

  const handleCheckChange = (key: keyof typeof checks) => {
    setChecks((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleStartTrading = () => {
    if (!allChecked) {
      alert('Please accept all terms to continue');
      return;
    }
    onAccept();
  };

  if (!isOpen) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header} >
          <div style={{width:'100%',height:70,display:'flex',alignItems:'center',paddingLeft:20}}>

              <h2>Terms of Use, Privacy Policy, and Cookie Policy</h2>
          </div>

          <div className={styles.closeBtnContainer}>
          <button className={styles.closeBtn} onClick={onClose}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path
                d="M18 6L6 18M6 6L18 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>

          </div>
        </div>

        <div className={styles.content}>
          <div className={styles.checkboxGroup}>
            <div className={styles.checkboxItem}>
              <div className={styles.checkboxWrapper}>
                <input
                  type="checkbox"
                  id="termsAndPrivacy"
                  checked={checks.termsAndPrivacy}
                  onChange={() => handleCheckChange('termsAndPrivacy')}
                  className={styles.checkbox}
                />
              </div>
              <label htmlFor="termsAndPrivacy" className={styles.label}>
                You acknowledge that you have read, understood, and agreed to{' '}
                <a href="/terms" target="_blank" className={styles.link}>
                  terms of use
                </a>{' '}
                and{' '}
                <a href="/privacy" target="_blank" className={styles.link}>
                  privacy policy
                </a>
              </label>
            </div>

            <div className={styles.checkboxItem}>
              <div className={styles.checkboxWrapper}>
                <input
                  type="checkbox"
                  id="cookiePolicy"
                  checked={checks.cookiePolicy}
                  onChange={() => handleCheckChange('cookiePolicy')}
                  className={styles.checkbox}
                />
              </div>
              <label htmlFor="cookiePolicy" className={styles.label}>
                Cookies and browser data are essential for proper functioning of the site, by using
                the site you agree to{' '}
                <a href="/cookies" target="_blank" className={styles.link}>
                  cookie policy
                </a>
              </label>
            </div>

            <div className={styles.checkboxItem}>
              <div className={styles.checkboxWrapper}>
                <input
                  type="checkbox"
                  id="enableTrading"
                  checked={checks.enableTrading}
                  onChange={() => handleCheckChange('enableTrading')}
                  className={styles.checkbox}
                />
              </div>
              <label htmlFor="enableTrading" className={styles.label}>
                Enable trading: this will enable one click trading on the application [required]
              </label>
            </div>
          </div>

          <button
            className={`${styles.startBtn} ${!allChecked ? styles.disabled : ''}`}
            onClick={handleStartTrading}
            disabled={!allChecked}
          >
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
    </div>
  );
}

