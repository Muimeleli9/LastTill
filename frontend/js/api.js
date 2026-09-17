import { getClient } from './supabase-client.js';

export async function result(request) {
  const { data, error, status } = await request;
  if (error) {
    if (status !== undefined) error.status = status;
    throw error;
  }
  return data;
}
export function rpc(name, data = {}) {
  return result(getClient().rpc(`lt_${name}`, { p_data: data }));
}
export const summary = () => result(getClient().rpc('lt_summary'));
export const budget = month => result(getClient().rpc('lt_budget', { p_month: month }));
export const profile = id => result(getClient().from('profiles').select('*').eq('id', id).single());
export const settings = id => result(getClient().from('user_settings').select('*').eq('user_id', id).single());
export const fund = id => result(getClient().from('emergency_funds').select('*').eq('user_id', id).maybeSingle());
export async function categories() {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const batch = await result(getClient().from('categories').select('category_id,name').order('category_id').range(offset, offset + 499));
    rows.push(...batch);
    if (batch.length < 500) return rows.sort((a, b) => a.name.localeCompare(b.name));
  }
}
export async function history(table, column, page = 0, filter = {}, select = '*') {
  let query = getClient().from(table).select(select).order(column, { ascending: false });
  for (const [key, value] of Object.entries(filter)) query = query.eq(key, value);
  const rows = await result(query.range(page * 10, page * 10 + 10));
  return { rows: rows.slice(0, 10), hasMore: rows.length > 10 };
}
export async function allGoals(id) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const batch = await result(getClient().from('savings_goals').select('*').eq('user_id', id).order('goal_id', { ascending: false }).range(offset, offset + 499));
    rows.push(...batch);
    if (batch.length < 500) return rows;
  }
}
export const saveSettings = (id, data) => result(getClient().from('user_settings').update(data).eq('user_id', id).select().single());
export const markRead = (id, userId) => result(getClient().from('notifications').update({ is_read: true }).eq('notification_id', id).eq('user_id', userId).select().single());
export async function unreadCount(userId) {
  const { count, error } = await getClient().from('notifications').select('notification_id', { count: 'exact', head: true }).eq('user_id', userId).eq('is_read', false);
  if (error) throw error;
  if (!Number.isInteger(count) || count < 0) throw new Error('The unread notification count is unavailable. Please reload.');
  return count;
}
