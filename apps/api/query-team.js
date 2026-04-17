const { Pool } = require('pg');
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required.');
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  const { rows } = await pool.query("select id, name, tag, \"organizationId\", \"deletedAt\" from \"Team\" where id=$1", ['ede28c4d-4169-4efa-9457-66d375fc62cd']);
  console.log(rows);
  await pool.end();
})();
