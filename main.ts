import {
  App,
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  MarkdownView,
  Modal,
  Notice,
  Platform,
  apiVersion,
  Plugin,
  PluginSettingTab,
  Setting,
  setIcon,
} from 'obsidian';
import { EditorView } from '@codemirror/view';
import { Transaction } from '@codemirror/state';

import { GROUPS, GROUP_ICONS, ROWS } from './src/data.ts';
import { mayComplete } from './src/guard.ts';
import { frecency, record, top } from './src/history.ts';
import { planInsert } from './src/insert.ts';
import { ALL, lookupChar, lookupShortcode, search, withTone } from './src/logic.ts';
import type { Emoji } from './src/logic.ts';
import { DEFAULTS, normalizeSettings } from './src/settings.ts';
import type { Settings } from './src/settings.ts';
import { findClosed, findTrigger } from './src/trigger.ts';
import { findUnsupported } from './src/support.ts';

const TONE_NAMES = ['Default', 'Light', 'Medium-light', 'Medium', 'Medium-dark', 'Dark'];
const SUPPORT_KEY = 'emoji-search-unsupported';
const HISTORY_MAX = 200;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Sentence-case name, with the skin tone the way Unicode writes it. */
const nameOf = (e: Emoji) => cap(e.label);

export default class EmojiSearchPlugin extends Plugin {
  settings: Settings = { ...DEFAULTS };
  /** Emojis this device cannot draw; kept per device in local storage, never in data.json. */
  unsupported = new Set<string>();
  /** Called when detection finishes, so an open picker can drop the missing glyphs. */
  onSupportChange: (() => void) | null = null;
  private saveTimer: number | null = null;
  private detecting = false;

  async onload() {
    this.settings = normalizeSettings(await this.loadData());
    this.loadSupport();

    this.addCommand({
      id: 'insert-emoji',
      name: 'Insert emoji',
      icon: 'smile-plus',
      callback: () => this.openPicker(),
    });
    this.addRibbonIcon('smile-plus', 'Insert emoji', () => this.openPicker());
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu) => {
        if (!this.settings.editorMenu) return;
        menu.addItem((item) => item.setTitle('Insert emoji').setIcon('smile-plus').onClick(() => this.openPicker()));
      }),
    );
    this.registerEditorSuggest(new ShortcodeSuggest(this));
    this.registerEditorExtension(closingColon(this));
    this.addSettingTab(new EmojiSettingTab(this.app, this));
  }

  onunload() {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      void this.saveData(this.settings);
    }
  }

  /** The editor to insert into, or null in reading view and anywhere there is none (the note is never edited behind the reader). */
  activeEditor(): Editor | null {
    const info = this.app.workspace.activeEditor;
    if (!info?.editor) return null;
    if (info instanceof MarkdownView && info.getMode() === 'preview') return null;
    return info.editor;
  }

  openPicker() {
    new EmojiModal(this.app, this).open();
  }

  /** Writes settings now. */
  saveSettings() {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = null;
    return this.saveData(this.settings);
  }

  /** History changes on every insert; the disk write waits until typing pauses. */
  private saveSoon() {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveData(this.settings);
    }, 800);
  }

  /** The character to insert for `e` (current skin tone), counted in the history. */
  remember(e: Emoji): string {
    const char = withTone(e, this.settings.tone);
    this.settings.history = record(this.settings.history, char, Date.now(), HISTORY_MAX);
    this.saveSoon();
    return char;
  }

  frecencyOf = (e: Emoji) => frecency(this.settings.history, e.char, Date.now());

  hidden(): ReadonlySet<string> {
    return this.settings.showUnsupported ? new Set() : this.unsupported;
  }

  /** Inserts at every cursor in one transaction (one undo); with no editor, copies to the clipboard. */
  async insert(e: Emoji, editor: Editor | null) {
    const char = this.remember(e);
    if (editor) {
      const plan = planInsert(
        editor.listSelections().map((s) => ({ from: s.anchor, to: s.head })),
        char,
      );
      editor.transaction({
        changes: plan.changes,
        selections: plan.selections,
      });
      editor.focus();
      return;
    }
    try {
      await navigator.clipboard.writeText(char);
      new Notice(`${char} copied`);
    } catch {
      new Notice(`${char}: select a note to insert it`);
    }
  }

  private loadSupport() {
    const key = this.supportKey();
    const saved = this.app.loadLocalStorage(SUPPORT_KEY) as { key?: string; chars?: unknown } | null;
    if (saved?.key === key && Array.isArray(saved.chars)) {
      this.unsupported = new Set(saved.chars.filter((c): c is string => typeof c === 'string'));
    } else this.unsupported = new Set();
  }

  private supportKey() {
    const p = Platform;
    return [ROWS.length, apiVersion, p.isMacOS, p.isWin, p.isLinux, p.isIosApp, p.isAndroidApp].join('|');
  }

  /** Checks the emoji set in idle-time chunks; the answer is stored for this device only. */
  detectSupport(force = false) {
    const saved = this.app.loadLocalStorage(SUPPORT_KEY) as { key?: string } | null;
    if (this.detecting || (!force && saved?.key === this.supportKey())) return;
    this.detecting = true;
    const chars: string[] = [];
    for (const e of ALL) chars.push(e.char, ...e.skins);
    const bad: string[] = [];
    let i = 0;
    const step = () => {
      bad.push(...findUnsupported(chars.slice(i, i + 200)));
      i += 200;
      if (i < chars.length) {
        window.setTimeout(step, 0);
        return;
      }
      this.unsupported = new Set(bad);
      this.app.saveLocalStorage(SUPPORT_KEY, { key: this.supportKey(), chars: bad });
      this.detecting = false;
      this.onSupportChange?.();
    };
    window.setTimeout(step, 0);
  }
}

/** Picker: every emoji in sections, search over names, keywords, shortcodes and the emoji itself. */
class EmojiModal extends Modal {
  private plugin: EmojiSearchPlugin;
  private editor: Editor | null;
  private query = '';
  private navMode = false;
  private items: Emoji[] = [];
  private cells: HTMLElement[] = [];
  private index = 0;
  private input!: HTMLInputElement;
  private toneBtn!: HTMLElement;
  private scroller!: HTMLElement;
  private sections!: HTMLElement;
  private results!: HTMLElement;
  private info!: HTMLElement;
  private live!: HTMLElement;
  private tabs: HTMLElement[] = [];
  private sectionEls: HTMLElement[] = [];
  private liveTimer: number | null = null;
  private frame: number | null = null;

  constructor(app: App, plugin: EmojiSearchPlugin) {
    super(app);
    this.plugin = plugin;
    this.editor = plugin.activeEditor();
    // Escape clears a non-empty query first and only then closes. Obsidian registers the close
    // handler itself, so it is wrapped rather than competed with.
    const keys = (this.scope as unknown as { keys?: { key: string | null; func: (...args: unknown[]) => unknown }[] }).keys;
    const esc = keys?.find((k) => k.key === 'Escape');
    if (esc) {
      const close = esc.func;
      esc.func = (...args: unknown[]) => {
        if (this.query === '') return close(...args);
        this.input.value = '';
        this.query = '';
        this.render();
        this.input.focus();
        return false;
      };
    }
  }

  onOpen() {
    this.modalEl.addClass('emoji-search-modal');
    this.titleEl.setText('Insert emoji');

    const head = this.contentEl.createDiv({ cls: 'emoji-search-head' });
    this.input = head.createEl('input', {
      type: 'text',
      cls: 'emoji-search-input',
      attr: {
        placeholder: 'Search emojis',
        'aria-label': 'Search emojis',
        role: 'combobox',
        'aria-expanded': 'true',
        'aria-controls': 'emoji-search-list',
        'aria-autocomplete': 'list',
        autocomplete: 'off',
        spellcheck: 'false',
      },
    });
    this.toneBtn = head.createEl('button', { cls: 'emoji-search-tone', attr: { 'aria-haspopup': 'menu' } });
    this.toneBtn.addEventListener('click', () => this.cycleTone());
    this.paintTone();

    const bar = this.contentEl.createDiv({ cls: 'emoji-search-tabs' });
    const addTab = (label: string, icon: string, i: number) => {
      const el = bar.createEl('button', { cls: 'emoji-search-tab', text: icon, attr: { 'aria-label': label, title: label } });
      el.addEventListener('click', () => this.goToSection(i));
      this.tabs.push(el);
    };
    addTab('Frequently used', '🕘', 0);
    GROUPS.forEach((g, i) => addTab(cap(g), GROUP_ICONS[i], i + 1));

    this.scroller = this.contentEl.createDiv({ cls: 'emoji-search-scroll' });
    this.sections = this.scroller.createDiv({ cls: 'emoji-search-sections' });
    this.results = this.scroller.createDiv({ cls: 'emoji-search-results emoji-search-hidden', attr: { role: 'listbox', 'aria-label': 'Search results' } });
    this.sections.setAttribute('role', 'listbox');
    this.sections.setAttribute('aria-label', 'Emojis');
    this.sections.id = 'emoji-search-list';
    this.info = this.contentEl.createDiv({ cls: 'emoji-search-info' });
    this.live = this.contentEl.createDiv({ cls: 'emoji-search-live', attr: { 'aria-live': 'polite' } });

    // One listener for the whole grid instead of three per cell.
    for (const root of [this.sections, this.results]) {
      root.addEventListener('click', (ev) => {
        const i = this.cellIndex(ev.target);
        if (i >= 0) void this.choose(this.items[i], ev.shiftKey);
      });
      root.addEventListener('mouseover', (ev) => {
        const i = this.cellIndex(ev.target);
        if (i >= 0 && i !== this.index) this.setActive(i, false);
      });
    }
    this.scroller.addEventListener('scroll', () => this.onScroll());

    this.input.addEventListener('input', () => {
      this.query = this.input.value;
      this.navMode = false;
      this.render();
    });
    this.input.addEventListener('keydown', (ev) => this.onKey(ev));

    this.plugin.onSupportChange = () => this.render();
    this.plugin.detectSupport();
    this.render();
    if (!Platform.isPhone) this.input.focus();
  }

  onClose() {
    this.plugin.onSupportChange = null;
    if (this.liveTimer !== null) window.clearTimeout(this.liveTimer);
    if (this.frame !== null) window.cancelAnimationFrame(this.frame);
    this.contentEl.empty();
    this.tabs = [];
    this.cells = [];
    this.items = [];
    this.sectionEls = [];
  }

  private paintTone() {
    const tone = this.plugin.settings.tone;
    this.toneBtn.setText(withTone(lookupChar('✋')!, tone));
    this.toneBtn.setAttribute('aria-label', `Skin tone: ${TONE_NAMES[tone].toLowerCase()}`);
    this.toneBtn.setAttribute('title', `Skin tone: ${TONE_NAMES[tone].toLowerCase()}`);
  }

  private cycleTone() {
    const s = this.plugin.settings;
    s.tone = (s.tone + 1) % 6;
    this.paintTone();
    this.cells.forEach((cell, i) => {
      const e = this.items[i];
      if (e.skins.length) cell.setText(withTone(e, s.tone));
    });
    void this.plugin.saveSettings();
    this.input.focus();
  }

  private cellIndex(target: EventTarget | null): number {
    const el = (target as HTMLElement | null)?.closest?.('.emoji-search-cell');
    return el ? Number((el as HTMLElement).dataset.i) : -1;
  }

  private makeCell(parent: HTMLElement, e: Emoji, i: number, prefix: string): HTMLElement {
    const hidden = this.plugin.unsupported.has(e.char);
    const cell = parent.createDiv({
      cls: 'emoji-search-cell',
      text: withTone(e, this.plugin.settings.tone),
      attr: { role: 'option', id: `emoji-search-${prefix}${i}`, 'aria-label': nameOf(e), 'aria-selected': 'false', 'data-i': String(i) },
    });
    if (hidden) {
      cell.addClass('is-unsupported');
      cell.setAttribute('title', 'May not display on this device');
    }
    return cell;
  }

  /** Rebuilds the visible list: the sectioned grid with no query, a flat ranked list with one. */
  private render() {
    const s = this.plugin.settings;
    const q = this.query.trim();
    const hidden = this.plugin.hidden();
    this.items = [];
    this.cells = [];
    this.sectionEls = [];
    this.contentEl.toggleClass('is-searching', q !== '');

    if (q) {
      this.sections.addClass('emoji-search-hidden');
      this.results.removeClass('emoji-search-hidden');
      this.results.empty();
      const found = search(q, { limit: 300, frecency: this.plugin.frecencyOf, hidden });
      found.forEach((e, i) => {
        this.items.push(e);
        this.cells.push(this.makeCell(this.results, e, i, 'r'));
      });
      if (!found.length) {
        this.results.createDiv({ cls: 'emoji-search-empty', text: `No emojis match "${q}"` });
        this.results.createDiv({ cls: 'emoji-search-empty-hint', text: 'Search by name, keyword, :shortcode: or paste an emoji.' });
      }
      this.announce(found.length ? `${found.length} emojis` : 'No emojis match');
    } else {
      this.results.addClass('emoji-search-hidden');
      this.sections.removeClass('emoji-search-hidden');
      this.sections.empty();
      this.announce('');
      const frag = createFragment();
      const holder = createDiv();
      const block = (title: string, list: Emoji[], index: number) => {
        const sec = holder.createDiv({ cls: 'emoji-search-section', attr: { role: 'group', 'aria-label': title } });
        sec.createDiv({ cls: 'emoji-search-section-title', text: title });
        const grid = sec.createDiv({ cls: 'emoji-search-grid' });
        for (const e of list) {
          this.items.push(e);
          this.cells.push(this.makeCell(grid, e, this.items.length - 1, 'c'));
        }
        this.sectionEls[index] = sec;
        frag.appendChild(sec);
      };
      const frequent = top(s.history, s.frequentShown, Date.now())
        .map((c) => lookupChar(c))
        .filter((e): e is Emoji => !!e && !hidden.has(e.char));
      block('Frequently used', frequent, 0);
      GROUPS.forEach((g, gi) => block(cap(g), ALL.filter((e) => e.group === gi && !hidden.has(e.char)), gi + 1));
      this.sections.appendChild(frag);
      this.tabs[0]?.toggleClass('is-hidden', frequent.length === 0);
      if (frequent.length === 0) this.sectionEls[0].addClass('emoji-search-hidden');
    }
    this.index = Math.min(this.index, Math.max(0, this.items.length - 1));
    if (q) this.index = 0;
    this.setActive(this.index, false);
    this.onScroll();
  }

  private announce(text: string) {
    if (this.liveTimer !== null) window.clearTimeout(this.liveTimer);
    this.liveTimer = window.setTimeout(() => this.live.setText(text), 300);
  }

  private setActive(i: number, scroll: boolean) {
    this.cells[this.index]?.removeClass('is-selected');
    this.cells[this.index]?.setAttribute('aria-selected', 'false');
    this.index = Math.max(0, Math.min(i, this.cells.length - 1));
    const cell = this.cells[this.index];
    const e = this.items[this.index];
    if (!cell || !e) {
      this.info.empty();
      this.input.removeAttribute('aria-activedescendant');
      return;
    }
    cell.addClass('is-selected');
    cell.setAttribute('aria-selected', 'true');
    this.input.setAttribute('aria-activedescendant', cell.id);
    if (scroll) cell.scrollIntoView({ block: 'nearest' });
    this.info.empty();
    this.info.createSpan({ cls: 'emoji-search-info-glyph', text: withTone(e, this.plugin.settings.tone) });
    this.info.createSpan({ cls: 'emoji-search-info-name', text: nameOf(e) });
    if (e.shortcodes.length) {
      this.info.createSpan({ cls: 'emoji-search-info-codes', text: e.shortcodes.slice(0, 3).map((c) => `:${c}:`).join(' ') });
    }
    this.info.createSpan({ cls: 'emoji-search-info-hint', text: '↵ insert · ⇧↵ keep' });
  }

  /** The cell one row up or down, nearest in the same column, across section boundaries. */
  private vertical(dir: 1 | -1): number {
    const cur = this.cells[this.index];
    if (!cur) return this.index;
    const rect = (c: HTMLElement) => c.getBoundingClientRect();
    const curRect = rect(cur);
    let best = -1;
    let bestDx = Infinity;
    let rowTop: number | null = null;
    for (let i = this.index + dir; i >= 0 && i < this.cells.length; i += dir) {
      const r = rect(this.cells[i]);
      if (r.width === 0) continue;
      const moved = dir > 0 ? r.top > curRect.top + 1 : r.top < curRect.top - 1;
      if (!moved) continue;
      if (rowTop === null) rowTop = r.top;
      if (Math.abs(r.top - rowTop) > 1) break;
      const dx = Math.abs(r.left - curRect.left);
      if (dx < bestDx) {
        bestDx = dx;
        best = i;
      }
    }
    return best >= 0 ? best : this.index;
  }

  private onKey(ev: KeyboardEvent) {
    const horizontal = this.query === '' || this.navMode;
    switch (ev.key) {
      case 'ArrowRight':
      case 'ArrowLeft':
        if (!horizontal) return;
        ev.preventDefault();
        this.setActive(this.index + (ev.key === 'ArrowRight' ? 1 : -1), true);
        return;
      case 'ArrowDown':
      case 'ArrowUp':
        ev.preventDefault();
        this.navMode = true;
        this.setActive(this.vertical(ev.key === 'ArrowDown' ? 1 : -1), true);
        return;
      case 'PageDown':
      case 'PageUp': {
        ev.preventDefault();
        this.navMode = true;
        const h = this.cells[this.index]?.getBoundingClientRect().height || 40;
        const rows = Math.max(1, Math.floor(this.scroller.clientHeight / h) - 1);
        let i = this.index;
        for (let n = 0; n < rows; n++) {
          this.index = i;
          const next = this.vertical(ev.key === 'PageDown' ? 1 : -1);
          if (next === i) break;
          i = next;
        }
        this.index = Math.min(this.index, this.cells.length - 1);
        this.setActive(i, true);
        return;
      }
      case 'Home':
      case 'End':
        if (!(ev.ctrlKey || ev.metaKey)) return;
        ev.preventDefault();
        this.setActive(ev.key === 'Home' ? 0 : this.cells.length - 1, true);
        return;
      case 'Enter':
        ev.preventDefault();
        void this.choose(this.items[this.index], ev.shiftKey);
        return;
      case 'c':
      case 'C':
        if (!(ev.ctrlKey || ev.metaKey) || this.input.selectionStart !== this.input.selectionEnd) return;
        ev.preventDefault();
        if (this.items[this.index]) void navigator.clipboard.writeText(withTone(this.items[this.index], this.plugin.settings.tone));
        return;
      default:
    }
  }

  private async choose(e: Emoji | undefined, keepOpen: boolean) {
    if (!e) return;
    await this.plugin.insert(e, this.editor);
    if (keepOpen) {
      // The history changed, but the grid stays put so the person keeps their place.
      this.input.focus();
      return;
    }
    this.close();
  }

  private goToSection(i: number) {
    if (this.query) {
      this.input.value = '';
      this.query = '';
      this.render();
    }
    const sec = this.sectionEls[i];
    if (!sec || !sec.offsetParent) return;
    this.scroller.scrollTop = sec.offsetTop - this.sections.offsetTop;
    this.input.focus();
  }

  private onScroll() {
    if (this.frame !== null) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = null;
      if (this.query) {
        this.tabs.forEach((t) => t.removeClass('is-active'));
        return;
      }
      const y = this.scroller.scrollTop + this.sections.offsetTop + 4;
      let active = 0;
      this.sectionEls.forEach((sec, i) => {
        if (sec.offsetParent && sec.offsetTop <= y) active = i;
      });
      this.tabs.forEach((t, i) => t.toggleClass('is-active', i === active));
    });
  }
}

/** The `:shortcode` being typed, as a suggestion list. */
class ShortcodeSuggest extends EditorSuggest<Emoji> {
  private plugin: EmojiSearchPlugin;

  constructor(plugin: EmojiSearchPlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
    const s = this.plugin.settings;
    if (!s.suggest || editor.somethingSelected()) return null;
    const cm = (editor as unknown as { cm?: EditorView }).cm;
    if (cm?.composing) return null;
    const line = editor.getLine(cursor.line);
    const t = findTrigger(line, cursor.ch, s.minChars);
    if (!t) return null;
    // Only now, with a likely match, is the note scanned for code, math, links and the like.
    const before = editor.getRange({ line: 0, ch: 0 }, { line: cursor.line, ch: t.start });
    if (!mayComplete(before)) return null;
    this.limit = s.suggestMax;
    return { start: { line: cursor.line, ch: t.start }, end: cursor, query: t.query };
  }

  getSuggestions(ctx: EditorSuggestContext): Emoji[] {
    return search(ctx.query, {
      limit: this.plugin.settings.suggestMax,
      frecency: this.plugin.frecencyOf,
      hidden: this.plugin.hidden(),
    });
  }

  renderSuggestion(e: Emoji, el: HTMLElement) {
    el.addClass('emoji-search-suggestion');
    const q = this.context?.query ?? '';
    el.createSpan({ cls: 'emoji-search-suggestion-char', text: withTone(e, this.plugin.settings.tone), attr: { 'aria-hidden': 'true' } });
    const name = el.createSpan({ cls: 'emoji-search-suggestion-name' });
    const code = e.shortcodes.find((c) => c.includes(q)) ?? e.shortcodes[0];
    if (code) {
      const at = code.indexOf(q);
      name.appendText(':');
      if (at >= 0 && q) {
        name.appendText(code.slice(0, at));
        name.createEl('mark', { text: code.slice(at, at + q.length) });
        name.appendText(code.slice(at + q.length));
      } else name.appendText(code);
      name.appendText(':');
    } else name.setText(nameOf(e));
    if (!e.shortcodes.some((c) => c.includes(q))) el.createSpan({ cls: 'emoji-search-suggestion-why', text: nameOf(e) });
    if (this.plugin.frecencyOf(e) >= 1.5) setIcon(el.createSpan({ cls: 'emoji-search-suggestion-used', attr: { 'aria-label': 'Used often' } }), 'history');
  }

  selectSuggestion(e: Emoji) {
    const ctx = this.context;
    if (!ctx) return;
    // Synchronous: replaces exactly the range that was typed. History is saved later.
    const char = this.plugin.remember(e);
    const cm = (ctx.editor as unknown as { cm?: EditorView }).cm;
    if (!cm) {
      ctx.editor.replaceRange(char, ctx.start, ctx.end);
      return;
    }
    // Its own history step, so one undo gives back the :query that was typed.
    const from = ctx.editor.posToOffset(ctx.start);
    cm.dispatch({
      changes: { from, to: ctx.editor.posToOffset(ctx.end), insert: char },
      selection: { anchor: from + char.length },
      annotations: Transaction.userEvent.of('input.complete'),
    });
  }
}

/** Typing the closing colon of `:tada:` turns it into the emoji; Ctrl+Z gives `:tada:` back. */
function closingColon(plugin: EmojiSearchPlugin) {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (text !== ':' || from !== to || !plugin.settings.closingColon || view.composing) return false;
    const line = view.state.doc.lineAt(from);
    const typed = `${line.text.slice(0, from - line.from)}:`;
    const hit = findClosed(typed, typed.length);
    const emoji = hit ? lookupShortcode(hit.query) : undefined;
    if (!hit || !emoji) return false;
    if (!mayComplete(view.state.sliceDoc(0, line.from + hit.start))) return false;
    const char = plugin.remember(emoji);
    // Two steps, so they are two undo steps: the colon as typed, then the swap.
    view.dispatch({ changes: { from, insert: ':' }, selection: { anchor: from + 1 }, userEvent: 'input.type' });
    const start = line.from + hit.start;
    view.dispatch({
      changes: { from: start, to: from + 1, insert: char },
      selection: { anchor: start + char.length },
      annotations: Transaction.userEvent.of('input.complete'),
    });
    return true;
  });
}

class EmojiSettingTab extends PluginSettingTab {
  private plugin: EmojiSearchPlugin;
  private confirmClear = false;

  constructor(app: App, plugin: EmojiSearchPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private async setTone(tone: number) {
    this.plugin.settings.tone = tone;
    await this.plugin.saveSettings();
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const save = () => void this.plugin.saveSettings();

    new Setting(containerEl).setName('Picker').setHeading();

    new Setting(containerEl)
      .setName('Skin tone')
      .setDesc('Used for emojis that have skin tone variants, such as 👋. The picker has a button for it too.')
      .addDropdown((d) => {
        const hand = lookupChar('✋')!;
        const options: Record<string, string> = {};
        for (let i = 0; i < TONE_NAMES.length; i++) options[String(i)] = `${withTone(hand, i)} ${TONE_NAMES[i]}`;
        d.addOptions(options).setValue(String(s.tone)).onChange((v) => void this.setTone(Number(v)));
      });

    new Setting(containerEl)
      .setName('Frequently used shown')
      .setDesc('How many often-used emojis the picker lists at the top. Zero hides the section.')
      .addSlider((sl) =>
        sl.setLimits(0, 48, 8).setValue(s.frequentShown).onChange((v) => {
          s.frequentShown = v;
          save();
        }),
      );

    new Setting(containerEl)
      .setName('Show the picker in the editor menu')
      .addToggle((t) =>
        t.setValue(s.editorMenu).onChange((v) => {
          s.editorMenu = v;
          save();
        }),
      );

    new Setting(containerEl).setName('Typing').setHeading();

    new Setting(containerEl)
      .setName('Suggest while typing')
      .setDesc('Type a colon and two letters, like :smi, to get emoji suggestions in the editor.')
      .addToggle((t) =>
        t.setValue(s.suggest).onChange((v) => {
          s.suggest = v;
          save();
        }),
      );

    new Setting(containerEl)
      .setName('Letters before suggesting')
      .setDesc('Characters needed after the colon.')
      .addSlider((sl) =>
        sl.setLimits(1, 4, 1).setValue(s.minChars).onChange((v) => {
          s.minChars = v;
          save();
        }),
      );

    new Setting(containerEl)
      .setName('Suggestions shown')
      .addSlider((sl) =>
        sl.setLimits(3, 20, 1).setValue(s.suggestMax).onChange((v) => {
          s.suggestMax = v;
          save();
        }),
      );

    new Setting(containerEl)
      .setName('Convert complete shortcodes')
      .setDesc('Typing the closing colon of :tada: turns it into 🎉. Undo brings the text back.')
      .addToggle((t) =>
        t.setValue(s.closingColon).onChange((v) => {
          s.closingColon = v;
          save();
        }),
      );

    new Setting(containerEl).setName('Data').setHeading();

    new Setting(containerEl)
      .setName('Show emojis this device cannot display')
      .setDesc('Newer emojis can show up as empty boxes on older systems. They are hidden unless you turn this on.')
      .addToggle((t) =>
        t.setValue(s.showUnsupported).onChange((v) => {
          s.showUnsupported = v;
          save();
        }),
      )
      .addButton((b) =>
        b.setButtonText('Check again').onClick(() => {
          this.plugin.detectSupport(true);
          new Notice('Checking which emojis this device can display');
        }),
      );

    new Setting(containerEl)
      .setName('Frequently used emojis')
      .setDesc('The history behind the frequently used section and the order of suggestions.')
      .addButton((b) =>
        b.setButtonText(this.confirmClear ? 'Click again to clear' : 'Clear').onClick(() => {
          if (!this.confirmClear) {
            this.confirmClear = true;
            this.display();
            return;
          }
          this.confirmClear = false;
          s.history = {};
          save();
          this.display();
        }),
      );
  }
}
