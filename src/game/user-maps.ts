// The player's own maps (drafts, made in the map maker) and the community maps they've
// downloaded, kept in their own localStorage entry. They're registered with the simulation
// before the save is read, so runs in progress on them come back too.

import { checkDoc, docToMap, type MapDoc } from '../sim/custom-map';
import { registerMap, unregisterMap } from '../sim/level';

const KEY = 'fodeez-nutz/maps/v1';
/** Community maps kept on this device (the ones played most recently). */
const KEEP_COMMUNITY = 40;

export interface Draft {
  id: string;
  doc: MapDoc;
  updated: string;
  /** Set once it's on the community maps: as which id, and the layout and mode it was uploaded with. */
  uploaded?: { id: string; date: string; hash: string; mode: MapDoc['mode'] };
}

export interface CommunityCopy {
  id: string;
  doc: MapDoc;
  creator: { id: string; name: string; url?: string };
  /** When it was last played here, for keeping the most recent ones. */
  used: string;
}

interface Stored {
  drafts: Draft[];
  community: CommunityCopy[];
}

/**
 * Enough of a map to open in the editor. (A draft can be unfinished, say with no name, so the
 * full check is only for playing and uploading; a draft is never thrown away for failing it.)
 */
function openable(d: unknown): d is MapDoc {
  const m = d as MapDoc;
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  return !!m && typeof m === 'object' && (m.mode === 'original' || m.mode === 'newage') && num(m.world?.w) && num(m.world?.h) && num(m.start?.x) && num(m.start?.y) && num(m.goopReset?.x) && Array.isArray(m.platforms) && m.platforms.length >= 4;
}

function randomId(): string {
  const a = crypto.getRandomValues(new Uint8Array(8));
  return 'draft-' + [...a].map(b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
}

export class UserMaps {
  drafts: Draft[] = [];
  private community: CommunityCopy[] = [];

  constructor() {
    try {
      const raw = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as Stored | null;
      if (raw) {
        this.drafts = (raw.drafts ?? []).filter(d => typeof d?.id === 'string' && /^draft-/.test(d.id) && openable(d.doc));
        for (const d of this.drafts) if (typeof d.doc.name !== 'string') d.doc.name = 'Untitled map';
        this.community = (raw.community ?? []).filter(c => typeof c?.id === 'string' && /^c-/.test(c.id) && !checkDoc(c.doc));
      }
    } catch {
      // unreadable or blocked storage: start with none
    }
    for (const d of this.drafts) registerMap(docToMap(d.id, d.doc));
    for (const c of this.community) registerMap(docToMap(c.id, c.doc, c.creator.name));
  }

  private persist(): void {
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ drafts: this.drafts, community: this.community } satisfies Stored));
    } catch {
      // full or blocked: they last until the page closes
    }
  }

  draft(id: string): Draft | undefined {
    return this.drafts.find(d => d.id === id);
  }

  addDraft(doc: MapDoc): Draft {
    const d: Draft = { id: randomId(), doc, updated: new Date().toISOString() };
    this.drafts.unshift(d);
    registerMap(docToMap(d.id, d.doc));
    this.persist();
    return d;
  }

  /** Save an edit. The playable map is replaced, so the next run uses the new layout. */
  updateDraft(id: string, doc: MapDoc): void {
    const d = this.draft(id);
    if (!d) return;
    d.doc = structuredClone(doc);
    d.updated = new Date().toISOString();
    registerMap(docToMap(d.id, d.doc));
    this.persist();
  }

  markUploaded(id: string, communityId: string, hash: string, mode: MapDoc['mode']): void {
    const d = this.draft(id);
    if (!d) return;
    d.uploaded = { id: communityId, date: new Date().toISOString(), hash, mode };
    this.persist();
  }

  deleteDraft(id: string): void {
    this.drafts = this.drafts.filter(d => d.id !== id);
    unregisterMap(id);
    this.persist();
  }

  /** Who made a community map kept here (their player id). */
  creatorOf(id: string): string | null {
    return this.community.find(c => c.id === id)?.creator.id ?? null;
  }

  /** Keep a community map on this device and make it playable. */
  keepCommunity(id: string, doc: MapDoc, creator: CommunityCopy['creator']): void {
    this.community = [{ id, doc, creator, used: new Date().toISOString() }, ...this.community.filter(c => c.id !== id)].slice(0, KEEP_COMMUNITY);
    registerMap(docToMap(id, doc, creator.name));
    this.persist();
  }
}
