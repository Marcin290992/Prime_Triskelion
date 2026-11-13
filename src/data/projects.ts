// One place for every project. The list page (/projects) and the case-study
// template (/projects/[slug]) both read from here.
//
// A project WITHOUT `detail` is a placeholder: it shows on the list but has no
// page yet (its card links nowhere). Add `detail` and it gets /projects/<slug>/.
import type { ImageMetadata } from 'astro';
import deeer2 from '../img/deeer2.webp';
import scr1 from '../img/wos/screen-1.jpg';
import scr2 from '../img/wos/screen-2.jpg';
import scr3 from '../img/wos/screen-3.jpg';
import scr4 from '../img/wos/screen-4.jpg';

export interface GalleryImage {
  img: ImageMetadata;
  /** width / height, e.g. '16 / 10' */
  ratio: string;
  alt?: string;
}

export interface ProjectTab {
  label: string;
  text?: string;
  list?: string[];
}

export interface ProjectDetail {
  /** Short line in the case-study meta, e.g. "Branding & Web" */
  short: string;
  summary: string;
  /** Live site (the "Live" pill and the hero button). */
  url?: string;
  /** Picture of the desktop cinematic hero. */
  heroImage: string;
  /** The two big words that part on the desktop hero. */
  heroWords: [string, string];
  /** Title broken over two lines. */
  titleLines: [string, string];
  tabs: ProjectTab[];
  /** Rows of the gallery: one picture = full width, two = a pair. */
  gallery: GalleryImage[][];
}

export interface Project {
  slug: string;
  title: string;
  categories: string[];
  year: string;
  /** Card picture on the list: a local image, or a URL for a placeholder. */
  card: ImageMetadata | string;
  /** Background colour of the list section. */
  bg: string;
  /** Direction of the giant background word on the list (1 / -1). */
  speed: 1 | -1;
  detail?: ProjectDetail;
}

export const projects: Project[] = [
  {
    slug: 'winds-of-sinai',
    title: 'Winds of Sinai',
    categories: ['Brand Identity', 'Web Design', 'Development'],
    year: '2025',
    card: deeer2,
    bg: '#0c0d0b',
    speed: 1,
    detail: {
      short: 'Branding & Web',
      summary:
        'Full brand identity and website for a premium desert travel & experiences brand rooted in the Sinai Peninsula.',
      url: 'https://windsofsinai.com',
      heroImage: 'https://picsum.photos/seed/sinai/800/1200?grayscale',
      heroWords: ['WINDS OF', 'SINAI'],
      titleLines: ['Winds', 'Of Sinai'],
      tabs: [
        {
          label: 'Challenge',
          text: "A travel brand with deep roots in Sinai's landscape and culture needed an identity that could compete globally — premium, evocative, and trusted — without losing its authentic desert soul.",
        },
        {
          label: 'Approach',
          text: 'I started with a brand sprint — mood boards, competitor mapping, and tone-of-voice workshops. The visual language was built around sand, silence, and scale: muted earth palettes, wide-body type, and considered negative space.',
        },
        {
          label: 'Delivered',
          list: [
            'Logo System & Brand Identity',
            'Color Palette & Typography',
            'Web Design (Figma)',
            'Frontend Development (Astro)',
            'SEO & Performance',
          ],
        },
      ],
      // Stand-in screens until the real screenshots arrive.
      gallery: [
        [{ img: scr1, ratio: '16 / 10', alt: 'Winds Of Sinai — homepage' }],
        [
          { img: scr2, ratio: '4 / 5', alt: 'Winds Of Sinai — about page' },
          { img: scr3, ratio: '4 / 5', alt: 'Winds Of Sinai — contact page' },
        ],
        [{ img: scr4, ratio: '16 / 10', alt: 'Winds Of Sinai — experiences page' }],
        [
          { img: scr3, ratio: '1 / 1' },
          { img: scr1, ratio: '1 / 1' },
        ],
        [{ img: scr2, ratio: '16 / 10' }],
      ],
    },
  },
  {
    slug: 'project-two',
    title: 'Project Two',
    categories: ['Web Design', 'Development'],
    year: '2024',
    card: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1400&fit=crop',
    bg: '#0d0b0b',
    speed: -1,
  },
  {
    slug: 'project-three',
    title: 'Project Three',
    categories: ['Brand Identity', 'Strategy'],
    year: '2023',
    card: 'https://images.unsplash.com/photo-1634017839464-5c339ebe3cb4?q=80&w=1400&fit=crop',
    bg: '#0b0b0d',
    speed: 1,
  },
  {
    slug: 'project-four',
    title: 'Project Four',
    categories: ['Motion', 'Development'],
    year: '2023',
    card: deeer2,
    bg: '#0d0c0a',
    speed: -1,
  },
];

/** Projects that have a page, in list order. */
export const withPages = projects.filter((p) => p.detail);

export const hrefOf = (p: Project) => (p.detail ? `/projects/${p.slug}/` : '#');

/** The next project that has a page (wraps round); undefined when it is the only one. */
export function nextOf(slug: string): Project | undefined {
  const i = withPages.findIndex((p) => p.slug === slug);
  const next = withPages[(i + 1) % withPages.length];
  return next && next.slug !== slug ? next : undefined;
}
