const MAX_LIMIT = 100;

/** Parse ?page=&limit= safely. */
const parsePaging = (query = {}, defaultLimit = 10) => {
  let page = parseInt(query.page, 10);
  let limit = parseInt(query.limit, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = defaultLimit;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  return { page, limit, skip: (page - 1) * limit };
};

const buildPagination = ({ page, limit, total }) => {
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  return {
    totalRecords: total,
    totalPages,
    currentPage: page,
    perPage: limit,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
    from: total === 0 ? 0 : (page - 1) * limit + 1,
    to: Math.min(page * limit, total),
  };
};

/**
 * Generic paginated query. Backwards compatible with the previous helper signature.
 * `limit` is capped at 100 to protect the database.
 */
const paginate = async ({
  model,
  query = {},
  page = 1,
  limit = 10,
  sort = { createdAt: -1 },
  select = "",
  populate = "",
  lean = true,
}) => {
  const paging = parsePaging({ page, limit }, 10);

  let find = model.find(query).sort(sort).skip(paging.skip).limit(paging.limit);
  if (select) find = find.select(select);
  if (populate) find = find.populate(populate);
  if (lean) find = find.lean();

  const [data, total] = await Promise.all([find, model.countDocuments(query)]);

  return { data, pagination: buildPagination({ ...paging, total }) };
};

module.exports = paginate;
module.exports.paginate = paginate;
module.exports.parsePaging = parsePaging;
module.exports.buildPagination = buildPagination;
module.exports.MAX_LIMIT = MAX_LIMIT;
