/**
 * Home experience: optional, role-scoped navigation and visual storytelling.
 * Uses links already present in the page, never fetches or fabricates school metrics.
 */
const home = document.querySelector('main[data-home-experience]');
if (home) {
  const role = home.dataset.homeExperience;
  const flows = {
    student: {
      heading: 'Your next moves', label: 'LEARNING FLOW',
      items: [
        ['01', 'See your assignments', 'Review tasks, evidence and feedback', 'student-assessments.html'],
        ['02', 'Continue your project', 'Your repository and contributions', 'student-dashboard.html'],
        ['03', 'Practise a skill', 'Short guided coding missions', 'student-practice.html']
      ]
    },
    teacher: {
      heading: 'Teaching workflow', label: 'START HERE',
      items: [
        ['01', 'Review & Grade', 'Review project evidence and progress', 'repofetch.html'],
        ['02', 'Prepare a lesson', 'Plan the next learning activity', 'lesson-planner.html'],
        ['03', 'Open Gradebook', 'Manage reviewed grades and feedback', 'gradebook.html']
      ]
    },
    admin: {
      heading: 'School operations', label: 'ADMIN WORKFLOW',
      items: [
        ['01', 'Review support reports', 'Handle issues requiring attention', 'issues.html'],
        ['02', 'Manage enrollment', 'Student records and school access', 'users.html'],
        ['03', 'Assign teaching access', 'Staff, sections and permissions', 'teacher-accounts.html']
      ]
    }
  };
  const flow = flows[role];
  if (flow) {
    const hero = home.querySelector(role === 'admin' ? '.av-admin-motion-hero' : '.av-home-hero');
    if (hero) {
      hero.classList.add('av-experience-hero');
      let copy = role === 'student' ? hero.querySelector('.max-w-3xl') : null;
      if (copy) copy.classList.add('av-experience-copy');
      else {
        copy = document.createElement('div');
        copy.className = 'av-experience-copy';
        const children = [...hero.children].filter(node => !node.classList.contains('av-motion-ambient'));
        children[0]?.before(copy);
        children.forEach(node => copy.append(node));
      }
      const board = document.createElement('aside');
      board.className = 'av-experience-board';
      board.setAttribute('aria-label', flow.heading);
      const top = document.createElement('div');
      top.className = 'av-experience-board-top';
      const heading = document.createElement('strong');
      heading.textContent = flow.heading;
      const label = document.createElement('span');
      label.textContent = flow.label;
      top.append(heading, label);
      board.append(top);
      flow.items.forEach(([index, title, description, href]) => {
        const link = document.createElement('a');
        link.href = href;
        const sequence = document.createElement('span');
        sequence.className = 'av-exp-sequence';
        sequence.textContent = index;
        sequence.setAttribute('aria-hidden', 'true');
        const action = document.createElement('span');
        action.className = 'av-exp-action';
        const strong = document.createElement('strong');
        strong.textContent = title;
        const small = document.createElement('small');
        small.textContent = description;
        action.append(strong, small);
        const arrow = document.createElement('span');
        arrow.className = 'av-exp-arrow';
        arrow.textContent = '↗';
        arrow.setAttribute('aria-hidden', 'true');
        link.append(sequence, action, arrow);
        board.append(link);
      });
      hero.append(board);
    }
  }

  if (role === 'public') {
    const stages = [
      ['Prepare & assign', 'Create a task and connect it to a teaching section.'],
      ['Build & practise', 'Code in a playground, complete practice missions and prepare project evidence.'],
      ['Review & improve', 'Examine verified work, give feedback and decide when to publish reviewed grades.']
    ];
    const preview = home.querySelector('.av-public-preview');
    const steps = [...(preview?.querySelectorAll('ol > li') || [])];
    if (steps.length === stages.length) {
      const detail = document.createElement('div');
      detail.className = 'av-story-detail';
      detail.setAttribute('role', 'status');
      detail.setAttribute('aria-live', 'polite');
      const title = document.createElement('strong');
      const summary = document.createElement('p');
      detail.append(title, summary);
      preview.append(detail);
      const select = selected => {
        steps.forEach((step, index) => {
          step.querySelector('button')?.setAttribute('aria-pressed', String(selected === index));
        });
        title.textContent = stages[selected][0];
        summary.textContent = stages[selected][1];
      };
      steps.forEach((step, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'av-story-pick';
        const number = document.createElement('span');
        number.textContent = String(index + 1);
        number.setAttribute('aria-hidden', 'true');
        const copy = document.createElement('span');
        copy.className = 'av-story-copy';
        const heading = document.createElement('strong');
        heading.textContent = stages[index][0];
        const description = document.createElement('span');
        description.textContent = step.querySelector('p')?.textContent?.trim() || stages[index][1];
        copy.append(heading, description);
        button.append(number, copy);
        button.addEventListener('click', () => select(index));
        step.replaceChildren(button);
      });
      select(0);
    }
  }

  // Shared quick-jump search is populated only with visible links from this page.
  // This avoids leaking unavailable administrator routes into student/guest lists.
  const createLauncher = () => {
    if (typeof HTMLDialogElement === 'undefined') return;
    const target = home.querySelector('.av-experience-copy, .av-public-hero > div:first-child, .av-motion-hero-copy');
    if (!target) return;
    const launcher = document.createElement('button');
    launcher.className = 'av-experience-launch';
    launcher.type = 'button';
    launcher.textContent = 'Find a workspace tool';
    const shortcut = document.createElement('kbd');
    shortcut.textContent = 'Ctrl K';
    shortcut.setAttribute('aria-hidden', 'true');
    launcher.append(shortcut);
    target.append(launcher);

    const dialog = document.createElement('dialog');
    dialog.className = 'av-experience-dialog';
    dialog.setAttribute('aria-label', 'Find a workspace tool');
    const header = document.createElement('div');
    header.className = 'av-jump-header';
    const heading = document.createElement('strong');
    heading.textContent = 'Jump to a workspace';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'av-jump-close';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close workspace search');
    header.append(heading, close);
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search available pages or actions…';
    search.setAttribute('aria-label', 'Search workspace destinations');
    search.autocomplete = 'off';
    const results = document.createElement('nav');
    results.className = 'av-jump-results';
    results.setAttribute('aria-label', 'Matching destinations');
    const footer = document.createElement('footer');
    footer.textContent = '↑ ↓ to navigate · Enter to open · Esc to close';
    dialog.append(header, search, results, footer);
    document.body.append(dialog);

    let choices = [];
    let active = 0;
    const pageLinks = () => {
      const seen = new Set();
      return [...document.querySelectorAll('main a[href], .av-documentation-nav a[href], .av-public-header a[href]')]
        .filter(link => {
          if (!link.getAttribute('href') || link.getAttribute('href').startsWith('#')) return false;
          if (link.closest('[hidden], .hidden, [aria-hidden="true"]')) return false;
          if (!link.getClientRects().length) return false;
          const key = new URL(link.getAttribute('href'), location.href).href;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).map(link => {
          const title = link.querySelector('h3, h2, strong')?.textContent?.trim()
            || link.getAttribute('aria-label') || link.textContent.trim();
          return {href: link.href, title: title.replace(/\s+/g, ' ').slice(0, 92),
            searchText: link.textContent.toLowerCase(), path: new URL(link.href).pathname.split('/').pop() || 'Home'};
        }).filter(item => item.title);
    };
    const updateActive = () => {
      [...results.querySelectorAll('a')].forEach((link, index) => link.dataset.active = String(index === active));
    };
    const render = () => {
      const query = search.value.trim().toLowerCase();
      choices = pageLinks().filter(item => !query || (item.title + ' ' + item.searchText + ' ' + item.path).toLowerCase().includes(query)).slice(0, 14);
      active = 0;
      results.replaceChildren();
      if (!choices.length) {
        const empty = document.createElement('p');
        empty.className = 'av-jump-empty';
        empty.textContent = 'No matching destination on this page.';
        results.append(empty);
      }
      for (const item of choices) {
        const link = document.createElement('a');
        link.href = item.href;
        const title = document.createElement('span');
        title.textContent = item.title;
        const path = document.createElement('small');
        path.textContent = item.path;
        link.append(title, path);
        results.append(link);
      }
      updateActive();
    };
    const open = () => {
      if (document.body.classList.contains('hidden') || dialog.open) return;
      search.value = '';
      dialog.showModal();
      render();
      search.focus();
    };
    launcher.addEventListener('click', open);
    close.addEventListener('click', () => dialog.close());
    search.addEventListener('input', render);
    search.addEventListener('keydown', event => {
      if (!choices.length) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        active = (active + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
        updateActive();
        results.querySelectorAll('a')[active]?.scrollIntoView({block: 'nearest'});
      } else if (event.key === 'Enter') {
        event.preventDefault();
        location.assign(choices[active].href);
      }
    });
    dialog.addEventListener('click', event => {
      if (event.target === dialog) dialog.close();
    });
    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !event.altKey) {
        if (document.body.classList.contains('hidden')) return;
        event.preventDefault();
        if (dialog.open) dialog.close(); else open();
      }
    });
  };
  createLauncher();
}
