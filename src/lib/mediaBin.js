const safeString = (value) => (typeof value === "string" ? value : "");

const normalizeText = (value) => safeString(value).trim().toLocaleLowerCase();

const finiteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const getMediaDuration = (item, durations = {}) => {
  const fromMap = durations?.[item.id];
  const fromItem = item.duration;
  return Math.max(0, finiteNumber(fromMap ?? fromItem, 0));
};

const getImportedAtMs = (item) => {
  const value = item.importedAt || item.addedAt || "";
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
};

const mediaTypeRank = (type) => {
  switch (type) {
    case "video":
      return 0;
    case "image":
      return 1;
    case "audio":
      return 2;
    default:
      return 3;
  }
};

export function filterAndSortMedia(items, options = {}) {
  const source = Array.isArray(items) ? items : [];
  const query = normalizeText(options.query);
  const typeFilter = options.typeFilter || "all";
  const sortBy = options.sortBy || "importedAt";
  const durations = options.durations || {};

  return source
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      if (typeFilter !== "all" && (item.mediaType || "video") !== typeFilter)
        return false;
      if (!query) return true;
      const haystack =
        `${safeString(item.name)} ${safeString(item.path)} ${safeString(item.originalPath)}`.toLocaleLowerCase();
      return haystack.includes(query);
    })
    .sort((left, right) => {
      const a = left.item;
      const b = right.item;
      let result;
      switch (sortBy) {
        case "name":
          result = safeString(a.name).localeCompare(
            safeString(b.name),
            undefined,
            { sensitivity: "base" },
          );
          break;
        case "duration":
          result =
            getMediaDuration(b, durations) - getMediaDuration(a, durations);
          break;
        case "type":
          result =
            mediaTypeRank(a.mediaType) - mediaTypeRank(b.mediaType) ||
            safeString(a.name).localeCompare(safeString(b.name), undefined, {
              sensitivity: "base",
            });
          break;
        case "importedAt":
        default:
          result = getImportedAtMs(b) - getImportedAtMs(a);
          break;
      }
      return result || left.index - right.index;
    })
    .map(({ item }) => item);
}
