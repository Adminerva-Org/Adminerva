/**
 * Adminerva home activity theater.
 *
 * Deliberately illustrative: never reads student, account, enrollment, grade,
 * submission, or school activity data. Do not describe these scenes as live.
 * Authenticated personal summaries remain in the existing home-pulse service.
 */
import {loadPublicReleases, releaseNotifications} from './patch-history.mjs?v=1.4.19';

const home = document.querySelector('main[data-home-experience]');
const ROLE_SCENES = {
  public: {
    title: 'One school. Many moments. One connected place.',
    summary: 'Explore how teaching, learning and school operations work together in Adminerva.',
    items: [
      ['Learning', 'A learner explores a new idea', 'Try a coding experiment without signing in.', 'guest-playground.html', 'CODE / TRY'],
      ['Teaching', 'A teacher prepares the next task', 'Classwork and feedback belong in the same teaching flow.', 'wiki.html#review', 'CLASSROOM / PREPARE'],
      ['School', 'A school organizes its day', 'People, classes and enrollment can share one school context.', 'wiki.html#school-setup', 'SCHOOL / CONNECT'],
      ['Practice', 'A challenge becomes a discovery', 'Solve a small practice question, then explore the result.', 'guest-practice.html', 'PRACTICE / EXPLORE']
    ]
  },
  guest: {
    title: 'Explore the spaces behind the learning.',
    summary: 'Take a hands-on tour with open tools. These illustrations never use real student work.',
    items: [
      ['Studio', 'An idea takes shape', 'Open a playground and experiment with code.', 'guest-playground.html', 'STUDIO / BUILD'],
      ['Practice', 'A concept clicks into place', 'Try a short practice mission at your own pace.', 'guest-practice.html', 'PRACTICE / TRY'],
      ['Design', 'A layout comes together', 'Explore supported Android XML layouts.', 'guest-xml-lab.html', 'DESIGN / PREVIEW']
    ]
  },
  student: {
    title: 'Your learning has a next step.',
    summary: 'A visual guide to your workspace. Actual assignments and progress appear in your authenticated tools.',
    items: [
      ['Classroom', 'Find the task for your class', 'Open classwork and instructions for your enrolled classes.', 'student-classroom.html', 'CLASSROOM / LEARN'],
      ['Studio', 'Continue a project', 'Return to your coding workspace and save your work.', 'student-playground.html', 'STUDIO / CREATE'],
      ['Review', 'Learn from feedback', 'Check assessment results and submission status.', 'student-assessments.html', 'ASSESSMENT / REVIEW']
    ]
  },
  teacher: {
    title: 'Teaching is a connected journey.',
    summary: 'From preparation to evidence to Class Record, explore the flow without losing your class context.',
    items: [
      ['Classroom', 'Start in your class', 'Work with classwork, people and submissions in context.', 'teacher-classroom.html', 'CLASSROOM / TEACH'],
      ['Prepare', 'Shape the next assessment', 'Create and deploy an assessment from the teaching workflow.', 'assessment-studio.html', 'ASSESSMENT / PREPARE'],
      ['Review', 'Close the feedback loop', 'Review evidence and follow up on student work.', 'repofetch.html', 'EVIDENCE / REVIEW']
    ]
  },
  admin: {
    title: 'See the school behind every action.',
    summary: 'The school workspace connects people, classes, enrollment and academic oversight.',
    items: [
      ['People', 'Keep school access clear', 'Find the correct person and their school relationship.', 'people-access.html', 'PEOPLE / ACCESS'],
      ['Learning', 'Coordinate teaching and classes', 'Review academic configuration and class relationships.', 'school-academic-configuration.html', 'ACADEMICS / ORGANIZE'],
      ['Enrollment', 'Follow a learner’s placement', 'Manage school registration and section placement.', 'school-enrollment.html', 'REGISTRAR / PLACE']
    ]
  },
  platform: {
    title: 'A platform built around schools.',
    summary: 'Monitor school lifecycle and platform operations without mixing in private learner work.',
    items: [
      ['Registry', 'Support school operations', 'Review institution lifecycle and verified school status.', 'owner-schools.html', 'PLATFORM / REGISTRY'],
      ['Operations', 'Keep the platform accountable', 'Use platform monitoring and administrative tools.', 'admin-analytics.html', 'PLATFORM / OPERATE']
    ]
  }
};

if (home) {
  const role = home.dataset.homeExperience;
  const config = ROLE_SCENES[role];
  const hero = role === 'public' ? home.querySelector('.av-public-hero')
    : role === 'guest' ? home.querySelector('.av-guest-motion-hero')
    : role === 'admin' ? home.querySelector('header')
    : role === 'platform' ? home.querySelector('header')
    : home.querySelector('.av-home-hero');

  if (config && hero) {
    const stage = document.createElement('section');
    stage.className = 'av-activity-stage';
    stage.setAttribute('aria-labelledby', 'av-activity-heading');
    stage.innerHTML = `
      <div class="av-activity-content">
        <p class="av-activity-kicker"><span aria-hidden="true"></span> A DAY WITH ADMINERVA</p>
        <h2 id="av-activity-heading"></h2>
        <p class="av-activity-intro"></p>
        <div class="av-activity-choices" role="group" aria-label="Explore a school workflow"></div>
        <a class="av-activity-action" href="#">Explore this workflow <span aria-hidden="true">↗</span></a>
        <p class="av-activity-disclosure">Illustrative preview · Not a live user activity feed</p>
      </div>
      <div class="av-activity-scene">
        <div class="av-activity-rings" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="av-activity-core"><img src="assets/adminerva-emblem.png" width="72" height="72" alt="" loading="lazy"><span>ADMINERVA</span><small>School OS</small></div>
        <span class="av-activity-node av-activity-node--one" aria-hidden="true">Learn</span>
        <span class="av-activity-node av-activity-node--two" aria-hidden="true">Teach</span>
        <span class="av-activity-node av-activity-node--three" aria-hidden="true">Connect</span>
        <div class="av-activity-toast" aria-live="off">
          <p class="av-activity-toast-label">SAMPLE SCENARIO</p>
          <strong class="av-activity-toast-title"></strong>
          <p class="av-activity-toast-summary"></p>
          <span class="av-activity-toast-category"></span>
        </div>
      </div>`;
    stage.querySelector('h2').textContent = config.title;
    stage.querySelector('.av-activity-intro').textContent = config.summary;
    const choices = stage.querySelector('.av-activity-choices');
    const toast = stage.querySelector('.av-activity-toast');
    const action = stage.querySelector('.av-activity-action');
    const buttons = config.items.map((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item[0];
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => { select(index); pauseUntil = Date.now() + 20000; });
      choices.append(button);
      return button;
    });
    let selected = 0;
    let pauseUntil = 0;
    const select = index => {
      selected = index;
      const item = config.items[index];
      buttons.forEach((button, position) => button.setAttribute('aria-pressed', String(position === index)));
      toast.classList.remove('av-activity-toast--show');
      toast.querySelector('.av-activity-toast-title').textContent = item[1];
      toast.querySelector('.av-activity-toast-summary').textContent = item[2];
      toast.querySelector('.av-activity-toast-category').textContent = item[4];
      action.href = item[3];
      action.firstChild.textContent = 'Explore ' + item[0].toLowerCase() + ' ';
      stage.dataset.scene = String(index);
      if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        requestAnimationFrame(() => toast.classList.add('av-activity-toast--show'));
      }
    };
    const latest = document.createElement('a');
    latest.className = 'av-activity-release';
    latest.href = 'patch-notes.html';
    latest.innerHTML = '<span>ADMINERVA UPDATES</span><strong>See what\'s new</strong><span aria-hidden="true">↗</span>';
    stage.querySelector('.av-activity-content').append(latest);
    hero.after(stage);
    select(0);
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!reduceMotion?.matches && config.items.length > 1) {
      const timer = window.setInterval(() => {
        if (document.hidden || Date.now() < pauseUntil || !stage.isConnected || reduceMotion.matches) return;
        if (stage.matches(':hover') || stage.contains(document.activeElement)) return;
        select((selected + 1) % config.items.length);
      }, 9000);
      window.addEventListener('pagehide', () => clearInterval(timer), {once: true});
    }
    (async () => {
      try {
        const releases = await loadPublicReleases();
        const audience = role === 'student' || role === 'teacher' ? role : role === 'admin' || role === 'platform' ? 'admin' : null;
        const item = releaseNotifications(releases, audience)[0];
        if (!item || !stage.isConnected) return;
        const url = new URL(item.target, location.href);
        if (url.origin !== location.origin || url.pathname.split('/').pop() !== 'patch-notes.html') return;
        latest.href = url.href;
        latest.querySelector('strong').textContent = item.title.replace(/^Adminerva update · /, '').slice(0, 74);
      } catch {
        // Release history may be unavailable offline. Keep the ordinary public link.
      }
    })();
  }
}
