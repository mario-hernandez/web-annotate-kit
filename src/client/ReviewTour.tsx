import { useCallback } from 'react';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

import welcomeImg from '../assets/tour/tour-welcome.jpg';
import screenshotImg from '../assets/tour/tour-screenshot.jpg';
import resolveImg from '../assets/tour/tour-resolve.jpg';
import doneImg from '../assets/tour/tour-done.jpg';

const TOUR_DONE_KEY_SUFFIX = '-tour-done';

export interface UseReviewTourOptions {
  /** Storage key prefix (matches your ReviewProvider). Default: "wak". */
  storageKeyPrefix?: string;
  /** Localized button/heading strings. */
  i18n?: Partial<{
    next: string;
    prev: string;
    done: string;
    welcome: string;
    welcomeBody: string;
    addTitle: string;
    addBody: string;
    profileTitle: string;
    profileBody: string;
    panelTitle: string;
    panelBody: string;
    screenshotTitle: string;
    screenshotBody: string;
    resolveTitle: string;
    resolveBody: string;
    doneTitle: string;
    doneBody: string;
  }>;
}

const DEFAULT_I18N = {
  next: 'Next',
  prev: 'Previous',
  done: 'Start',
  welcome: 'Welcome to review mode',
  welcomeBody:
    'This tool lets you leave comments directly on the website. Your observations help us improve every detail. Let\'s see how it works.',
  addTitle: 'Add a comment',
  addBody:
    'Press this <strong>+</strong> button to activate comment mode. Then click anywhere on the page to drop an observation.',
  profileTitle: 'Your profile',
  profileBody:
    'Your initial is here. Click to open the <strong>Dashboard</strong>, export comments or sign out.',
  panelTitle: 'Comment panel',
  panelBody:
    'This button opens a side panel with every comment on the current page. From there you can jump to any comment, copy or download.',
  screenshotTitle: 'Automatic capture',
  screenshotBody:
    'Every time you leave a comment, a <strong>screenshot of what you see</strong> is saved so we know exactly what you mean.<br><br>The first time, the browser will ask for permission — just click <strong>"Allow"</strong>. Safe and stored only on our server.',
  resolveTitle: 'Edit and resolve',
  resolveBody:
    'Click any <strong>numbered pin</strong> on the page to see the comment. From there you can <strong>edit</strong>, <strong>delete</strong> or mark it as <strong>resolved</strong>.',
  doneTitle: 'All set',
  doneBody:
    'Browse the site, leave your comments and we take care of the changes. To see this tutorial again, click your initial → <strong>Tutorial</strong>.',
};

export function useReviewTour(options: UseReviewTourOptions = {}) {
  const prefix = options.storageKeyPrefix ?? 'wak';
  const i18n = { ...DEFAULT_I18N, ...options.i18n };
  const TOUR_KEY = prefix + TOUR_DONE_KEY_SUFFIX;
  const hasSeen = typeof window !== 'undefined' && localStorage.getItem(TOUR_KEY) === 'true';

  const startTour = useCallback(() => {
    setTimeout(() => {
      const d = driver({
        showProgress: true,
        animate: true,
        overlayColor: 'rgba(0, 0, 0, 0.7)',
        stagePadding: 8,
        stageRadius: 12,
        popoverClass: 'wak-tour-popover',
        nextBtnText: i18n.next,
        prevBtnText: i18n.prev,
        doneBtnText: i18n.done,
        progressText: '{{current}} / {{total}}',
        steps: [
          {
            popover: {
              title: i18n.welcome,
              description: `<img src="${welcomeImg}" style="width:100%;border-radius:8px;margin-bottom:12px" />${i18n.welcomeBody}`,
              side: 'over', align: 'center',
            },
          },
          {
            element: '[data-tour="btn-add"]',
            popover: { title: i18n.addTitle, description: i18n.addBody, side: 'top', align: 'end' },
          },
          {
            element: '[data-tour="btn-user"]',
            popover: { title: i18n.profileTitle, description: i18n.profileBody, side: 'left', align: 'end' },
          },
          {
            element: '[data-tour="btn-panel"]',
            popover: { title: i18n.panelTitle, description: i18n.panelBody, side: 'left', align: 'end' },
          },
          {
            popover: {
              title: i18n.screenshotTitle,
              description: `<img src="${screenshotImg}" style="width:100%;border-radius:8px;margin-bottom:12px" />${i18n.screenshotBody}`,
              side: 'over', align: 'center',
            },
          },
          {
            popover: {
              title: i18n.resolveTitle,
              description: `<img src="${resolveImg}" style="width:100%;border-radius:8px;margin-bottom:12px" />${i18n.resolveBody}`,
              side: 'over', align: 'center',
            },
          },
          {
            popover: {
              title: i18n.doneTitle,
              description: `<img src="${doneImg}" style="width:100%;border-radius:8px;margin-bottom:12px" />${i18n.doneBody}`,
              side: 'over', align: 'center',
            },
          },
        ],
        onDestroyStarted: () => {
          localStorage.setItem(TOUR_KEY, 'true');
          d.destroy();
        },
      });
      d.drive();
    }, 600);
  }, [TOUR_KEY, i18n]);

  return { hasSeen, startTour };
}

export function resetTour(storageKeyPrefix = 'wak') {
  localStorage.removeItem(storageKeyPrefix + TOUR_DONE_KEY_SUFFIX);
}
