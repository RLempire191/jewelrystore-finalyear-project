const pexels = (photoId: string, width: number) =>
  `https://images.pexels.com/photos/${photoId}/pexels-photo-${photoId}.jpeg?auto=compress&cs=tinysrgb&w=${width}`
const unsplash = (photoId: string) =>
  `https://images.unsplash.com/${photoId}?auto=format&fit=crop&w=1200&q=85`

export const heroImages = {
  hero: pexels('1453008', 1600),
  jewelryHero: pexels('3266700', 1600),
  collectionDetail: pexels('1453008', 1200),
  signatureBox: pexels('3266700', 1200),
  auroraBox: pexels('1458867', 1200),
  ourStoryHero: pexels('1453008', 1200),
  bridalHero: pexels('3266700', 1200),
  highJewelryHero: pexels('1458867', 1200),
} as const

export const productImages = {
  auroraRing: {
    main: pexels('3266700', 1200),
    gallery: [
      pexels('1458867', 1200),
      pexels('1453008', 1200),
      pexels('3266700', 1200),
    ],
  },
  celestialStuds: {
    main: pexels('1458867', 1200),
    gallery: [
      pexels('1453008', 1200),
      pexels('3266700', 1200),
      pexels('1453008', 1200),
    ],
  },
  etherealCuff: {
    main: unsplash('photo-1515562141207-7a88fb7ce338'),
    gallery: [
      pexels('3266700', 1200),
      pexels('1453008', 1200),
      pexels('1458867', 1200),
    ],
  },
  luminousNecklace: {
    main: unsplash('photo-1535632066927-ab7c9ab60908'),
    gallery: [
      pexels('1453008', 1200),
      pexels('3266700', 1200),
      pexels('1458867', 1200),
    ],
  },
  midnightBand: {
    main: unsplash('photo-1599643478518-a784e5dc4c8f'),
    gallery: [
      pexels('3266700', 1200),
      pexels('1453008', 1200),
      pexels('1453008', 1200),
    ],
  },
  heritageBracelet: {
    main: unsplash('photo-1601121141461-9d6647bca1ed'),
    gallery: [
      pexels('3266700', 1200),
      pexels('1453008', 1200),
      pexels('1458867', 1200),
    ],
  },
  lunaPendant: {
    main: pexels('3266700', 1200),
    gallery: [
      pexels('1458867', 1200),
      pexels('1453008', 1200),
      pexels('3266700', 1200),
    ],
  },
  solsticeWatch: {
    main: pexels('1453008', 1200),
    gallery: [
      pexels('1453008', 1200),
      pexels('1458867', 1200),
      pexels('3266700', 1200),
    ],
  },
  afterglowHoops: {
    main: unsplash('photo-1611652022419-a9419f74343d'),
    gallery: [unsplash('photo-1602751584552-8ba73aad10e1')],
  },
  aureliaChain: {
    main: unsplash('photo-1617038220319-276d3cfab638'),
    gallery: [unsplash('photo-1602173574767-37ac01994b2a')],
  },
  petalPendant: {
    main: unsplash('photo-1602173574767-37ac01994b2a'),
    gallery: [unsplash('photo-1617038220319-276d3cfab638')],
  },
  solisSignet: {
    main: unsplash('photo-1605100804763-247f67b3557e'),
    gallery: [unsplash('photo-1611591437281-460bfbe1220a')],
  },
  eveningBracelet: {
    main: unsplash('photo-1602751584552-8ba73aad10e1'),
    gallery: [unsplash('photo-1611652022419-a9419f74343d')],
  },
  pearlDrops: {
    main: unsplash('photo-1611591437281-460bfbe1220a'),
    gallery: [unsplash('photo-1605100804763-247f67b3557e')],
  },
  tidepoolPearl: {
    main: unsplash('photo-1611085583191-a3b181a88401'),
    gallery: [],
  },
  solaraHoops: {
    main: unsplash('photo-1506630448388-4e683c67ddb0'),
    gallery: [],
  },
  aureliaWatch: {
    main: unsplash('photo-1523275335684-37898b6baf30'),
    gallery: [],
  },
  sculptedCuff: {
    main: unsplash('photo-1603561596112-0a132b757442'),
    gallery: [],
  },
} as const

export const productImageFallback = pexels('1453008', 1200)
