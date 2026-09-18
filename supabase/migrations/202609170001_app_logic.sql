-- LastTill incremental application migration. Run in Supabase SQL Editor ONLY
-- after the supplied schema, RLS policies, and all three total-sync triggers.
-- This does not recreate tables, seed accounts, or apply itself remotely.
-- Apply to a backup/staging copy first. The transaction stops on invalid data.
-- Configure providers, redirect URLs, and email templates using .env.example.
begin;

do $$
declare t text; r record;
begin
  foreach t in array array['profiles','categories','income_sources','budgets',
    'budget_categories','expenses','savings_goals','savings_contributions',
    'emergency_funds','emergency_fund_transactions','tillcheck_history',
    'user_settings','notifications'] loop
    if to_regclass('public.' || t) is null then
      raise exception 'Missing prerequisite table: %', t;
    end if;
    if not (select relrowsecurity from pg_class where oid=to_regclass('public.'||t)) then
      raise exception 'Required RLS is disabled on table: %', t;
    end if;
  end loop;
  for r in select * from (values
    ('trg_expenses_after_change','public.expenses','public.trg_expenses_sync_spent()'),
    ('trg_savings_contrib_after_change','public.savings_contributions','public.trg_savings_contrib_sync()'),
    ('trg_emergency_txn_after_change','public.emergency_fund_transactions','public.trg_emergency_txn_sync()'),
    ('on_auth_user_created','auth.users','public.handle_new_user()')
  ) v(trigger_name,relation_name,function_name) loop
    if not exists (select 1 from pg_trigger where tgname=r.trigger_name
      and tgrelid=to_regclass(r.relation_name) and tgfoid=to_regprocedure(r.function_name)
      and not tgisinternal and tgenabled in ('O','A')) then
      raise exception 'Missing or disabled prerequisite trigger: % on %',r.trigger_name,r.relation_name;
    end if;
  end loop;
  for r in select * from (values
    ('account_type_enum',array['Student','Employed','Entrepreneur']),
    ('income_frequency_enum',array['Once-off','Weekly','Monthly']),
    ('payment_method_enum',array['Bank Card','Cash','Transfer','Mobile Payment']),
    ('goal_status_enum',array['active','completed','cancelled']),
    ('fund_txn_type_enum',array['deposit','withdrawal']),
    ('fund_txn_reason_enum',array['Medication','Transport Emergency','Urgent Food','Family Emergency','Other'])
  ) v(type_name,labels) loop
    if (select array_agg(e.enumlabel::text order by e.enumsortorder) from pg_enum e
      where e.enumtypid=to_regtype('public.'||r.type_name)) is distinct from r.labels then
      raise exception 'Unexpected or missing enum: %',r.type_name;
    end if;
  end loop;
  if exists(select 1 from public.budgets b where b.total_income is distinct from
      (select coalesce(sum(i.amount),0) from public.income_sources i where i.user_id=b.user_id
        and date_trunc('month',i.received_date)::date=b.period_month))
    or exists(select 1 from public.budget_categories bc join public.budgets b using(budget_id)
      where bc.spent_amount is distinct from (select coalesce(sum(e.amount),0) from public.expenses e
        where e.user_id=b.user_id and e.category_id=bc.category_id and date_trunc('month',e.expense_date)::date=b.period_month))
    or exists(select 1 from public.savings_goals g where g.saved_amount is distinct from
      (select coalesce(sum(c.amount),0) from public.savings_contributions c where c.goal_id=g.goal_id))
    or exists(select 1 from public.emergency_funds f where f.current_balance is distinct from
      (select coalesce(sum(case when t.type='deposit' then t.amount else -t.amount end),0)
        from public.emergency_fund_transactions t where t.fund_id=f.fund_id)) then
    raise exception 'Existing financial totals disagree with transaction history. Reconcile the affected records before applying this migration; no data was changed.';
  end if;
end $$;

alter table public.notifications add column if not exists event_key text;
create unique index if not exists lt_notifications_event_key on public.notifications(user_id,event_key);

-- Validation applies even to privileged maintenance writes. Existing invalid rows
-- intentionally stop this migration rather than being silently changed.
do $$
declare r record;
begin
  for r in select * from (values
    ('income_sources','lt_income_amount','amount > 0 and amount < 10000000000'),
    ('expenses','lt_expense_amount','amount > 0 and amount < 10000000000'),
    ('savings_contributions','lt_contribution_amount','amount > 0 and amount < 10000000000'),
    ('emergency_fund_transactions','lt_transaction_amount','amount > 0 and amount < 10000000000'),
    ('budget_categories','lt_budget_limit','limit_amount >= 0 and limit_amount < 10000000000'),
    ('savings_goals','lt_goal_target','target_amount > 0 and target_amount < 10000000000'),
    ('emergency_funds','lt_fund_target','target_amount >= 0 and target_amount < 10000000000'),
    ('emergency_funds','lt_fund_balance','current_balance >= 0 and current_balance < 10000000000'),
    ('profiles','lt_full_name','length(btrim(full_name)) between 1 and 120'),
    ('profiles','lt_salary_day','salary_day is null or salary_day between 1 and 31'),
    ('profiles','lt_cycle','monthly_cycle in (''1st to month-end'',''Salary date to next salary date'')'),
    ('budgets','lt_month_start','period_month = date_trunc(''month'',period_month)::date')
  ) as v(tbl,cname,expression) loop
    if not exists (select 1 from pg_constraint where conname=r.cname and conrelid=('public.'||r.tbl)::regclass) then
      execute format('alter table public.%I add constraint %I check (%s)',r.tbl,r.cname,r.expression);
    end if;
  end loop;
end $$;

-- Keep existing trigger calculations. Pin their resolution because RPCs use an
-- empty search_path, and revoke direct access to the maintenance entry point.
alter function public.recalc_budget_category_spent(integer,integer) set search_path=pg_catalog,public,pg_temp;
alter function public.trg_expenses_sync_spent() set search_path=pg_catalog,public,pg_temp;
alter function public.trg_savings_contrib_sync() set search_path=pg_catalog,public,pg_temp;
alter function public.trg_emergency_txn_sync() set search_path=pg_catalog,public,pg_temp;
alter function public.set_updated_at() set search_path=pg_catalog,public,pg_temp;
revoke all on function public.recalc_budget_category_spent(integer,integer) from public,anon,authenticated;
revoke all on function public.trg_expenses_sync_spent(), public.trg_savings_contrib_sync(),
  public.trg_emergency_txn_sync(), public.set_updated_at() from public,anon,authenticated;

-- Same provisioning behavior; tolerate provider names and untrusted metadata.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(id,full_name,account_type)
  values (new.id,coalesce(nullif(left(btrim(new.raw_user_meta_data->>'full_name'),120),''),'New User'),
    case when new.raw_user_meta_data->>'account_type' in ('Student','Employed','Entrepreneur')
      then (new.raw_user_meta_data->>'account_type')::public.account_type_enum
      else 'Student'::public.account_type_enum end);
  insert into public.user_settings(user_id) values(new.id);
  return new;
end $$;
revoke all on function public.handle_new_user() from public,anon,authenticated;

create or replace function public.lt_today() returns date
language sql stable set search_path='' as $$ select (now() at time zone 'Africa/Johannesburg')::date $$;

create or replace function public.lt_uid() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare u uuid := auth.uid();
begin
  if u is null or not exists(select 1 from public.profiles where id=u and is_active) then
    raise exception 'An active signed-in account is required' using errcode='42501';
  end if;
  return u;
end $$;

create or replace function public.lt_is_active() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles where id=auth.uid() and is_active)
$$;

create or replace function public.lt_lock_user() returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid := auth.uid();
begin
  -- All financial operations acquire this lock BEFORE reading money. Locks on
  -- separate users never block each other. Maintenance writes must do likewise.
  perform 1 from public.profiles where id=u and is_active for update;
  if not found then raise exception 'An active signed-in account is required' using errcode='42501'; end if;
  return u;
end $$;

create or replace function public.lt_amount(v text, allow_zero boolean default false) returns numeric
language plpgsql immutable set search_path='' as $$
declare n numeric;
begin
  if v is null or v !~ '^\d+(\.\d{1,2})?$' then raise exception 'Enter an amount with at most two decimal places'; end if;
  n := v::numeric;
  if n >= 10000000000 or n < 0 or (not allow_zero and n=0) then raise exception 'Amount is out of range'; end if;
  return n;
end $$;

create or replace function public.lt_name(v text, max_length integer) returns text
language plpgsql immutable set search_path='' as $$
begin
  if v is null or length(btrim(v))=0 or length(btrim(v))>max_length then
    raise exception 'Name is required and must be at most % characters',max_length;
  end if;
  return btrim(v);
end $$;

create or replace function public.lt_date(v text) returns date
language plpgsql stable set search_path='' as $$
declare d date;
begin
  if v is null or v !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'A valid date is required'; end if;
  d := v::date;
  if d > public.lt_today() or d < date '1900-01-01' then raise exception 'Use an actual transaction date, not a future date'; end if;
  return d;
end $$;

create or replace function public.lt_cycle(p_on date) returns table(start_date date,end_date date,days integer)
language plpgsql stable security definer set search_path='' as $$
declare p public.profiles; m date; day_number integer; anchor date;
begin
  select * into strict p from public.profiles where id=public.lt_uid();
  day_number := case when p.monthly_cycle='Salary date to next salary date' then coalesce(p.salary_day,1) else 1 end;
  m := date_trunc('month',p_on)::date;
  anchor := m + (least(day_number,extract(day from (m+interval '1 month - 1 day'))::integer)-1);
  if p_on < anchor then m := (m-interval '1 month')::date; end if;
  start_date := m + (least(day_number,extract(day from (m+interval '1 month - 1 day'))::integer)-1);
  m := (m+interval '1 month')::date;
  end_date := m + (least(day_number,extract(day from (m+interval '1 month - 1 day'))::integer)-1);
  days := end_date-p_on;
  return next;
end $$;

create or replace function public.lt_summary() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid := public.lt_uid(); d date := public.lt_today(); c record;
  i numeric; e numeric; s numeric; f numeric; r numeric;
begin
  select * into c from public.lt_cycle(d);
  select coalesce(sum(amount),0) into i from public.income_sources where user_id=u and received_date between c.start_date and d;
  select coalesce(sum(amount),0) into e from public.expenses where user_id=u and expense_date between c.start_date and d;
  select coalesce(sum(sc.amount),0) into s from public.savings_contributions sc
    join public.savings_goals g on g.goal_id=sc.goal_id where g.user_id=u and sc.contribution_date between c.start_date and d;
  select coalesce(sum(t.amount),0) into f from public.emergency_fund_transactions t
    join public.emergency_funds ef on ef.fund_id=t.fund_id where ef.user_id=u and t.type='deposit' and t.transaction_date between c.start_date and d;
  r := i-e-s-f;
  return jsonb_build_object('start',c.start_date,'end',c.end_date,'today',d,'days',c.days,
    'income',i,'expenses',e,'savings',s,'deposits',f,'remaining',r,
    'safe_daily',floor(greatest(r,0)*100/c.days)/100);
end $$;

create or replace function public.lt_ensure_budget(u uuid,m date) returns integer
language plpgsql set search_path='' as $$
declare b integer;
begin
  if m is null or m <> date_trunc('month',m)::date then raise exception 'Use the first day of a calendar month'; end if;
  insert into public.budgets(user_id,period_month,total_income)
  values(u,m,(select coalesce(sum(amount),0) from public.income_sources where user_id=u and date_trunc('month',received_date)::date=m))
  on conflict(user_id,period_month) do update set total_income=excluded.total_income
  returning budget_id into b;
  return b;
end $$;

create or replace function public.lt_budget(p_month date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=public.lt_uid(); b public.budgets; rows jsonb; spent numeric; income numeric;
begin
  if p_month is null or p_month <> date_trunc('month',p_month)::date then raise exception 'Use a calendar month'; end if;
  select * into b from public.budgets where user_id=u and period_month=p_month;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.name),'[]'::jsonb) into rows from (
    select bc.*,c.name from public.budget_categories bc join public.categories c using(category_id) where bc.budget_id=b.budget_id
  ) x;
  select coalesce(sum(amount),0) into spent from public.expenses where user_id=u and date_trunc('month',expense_date)::date=p_month;
  select coalesce(sum(amount),0) into income from public.income_sources where user_id=u and date_trunc('month',received_date)::date=p_month;
  return jsonb_build_object('budget_id',b.budget_id,'month',p_month,'categories',rows,'spent',spent,'income',income);
end $$;

create or replace function public.lt_alerts(u uuid) returns void
language plpgsql set search_path='' as $$
declare prefs public.user_settings; b record; g record; s jsonb; threshold integer;
begin
  select * into prefs from public.user_settings where user_id=u;
  if prefs.notify_budget_alerts then
    for b in select bc.*,c.name from public.budget_categories bc join public.budgets bu using(budget_id)
      join public.categories c using(category_id) where bu.user_id=u and bu.period_month=date_trunc('month',public.lt_today())::date loop
      foreach threshold in array array[90,100] loop
        if (b.limit_amount>0 and b.spent_amount>=b.limit_amount*threshold/100) or (b.limit_amount=0 and b.spent_amount>0) then
          insert into public.notifications(user_id,title,message,event_key)
          values(u,'Category budget alert',b.name||' has reached '||threshold||'% of its calendar-month limit.',
            'budget:'||b.budget_category_id||':'||threshold) on conflict(user_id,event_key) do nothing;
        end if;
      end loop;
    end loop;
  end if;
  if prefs.notify_goal_progress then
    for g in select * from public.savings_goals where user_id=u and status <> 'cancelled' loop
      foreach threshold in array array[50,100] loop
        if g.target_amount>0 and g.saved_amount>=g.target_amount*threshold/100 then
          insert into public.notifications(user_id,title,message,event_key)
          values(u,'Savings milestone',g.goal_name||' has reached '||threshold||'% of its target.',
            'goal:'||g.goal_id||':'||threshold) on conflict(user_id,event_key) do nothing;
        end if;
      end loop;
    end loop;
  end if;
  if prefs.notify_low_balance then
    s:=public.lt_summary();
    foreach threshold in array array[10,0] loop
      if (s->>'income')::numeric>0 and (s->>'remaining')::numeric<=(s->>'income')::numeric*threshold/100 then
        insert into public.notifications(user_id,title,message,event_key)
        values(u,'Low spendable balance','Cycle spendable money is at or below '||threshold||'% of received income.',
          'balance:'||(s->>'start')||':'||threshold) on conflict(user_id,event_key) do nothing;
      end if;
    end loop;
  end if;
end $$;

-- Internal dispatcher centralizes locking and validation; only action-specific
-- wrappers below are exposed. It cannot be executed directly by API clients.
create or replace function public.lt_write(action text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
<<mutation>>
declare
  u uuid:=public.lt_lock_user(); id integer:=nullif(p->>'id','')::integer;
  amount numeric; d date; m date; old_month date; b integer; category integer;
  result jsonb; summary jsonb; goal public.savings_goals; fund public.emergency_funds;
  checked public.tillcheck_history; before_daily numeric; after_remaining numeric;
  limit_value numeric; spent numeric; ctype public.fund_txn_type_enum;
  reason_value public.fund_txn_reason_enum; profile_cycle text; salary integer;
begin
  if p is null or jsonb_typeof(p)<>'object' then raise exception 'Invalid request'; end if;
  case action
  when 'save_profile' then
    profile_cycle:=p->>'monthly_cycle'; salary:=nullif(p->>'salary_day','')::integer;
    if profile_cycle not in ('1st to month-end','Salary date to next salary date') or profile_cycle is null then raise exception 'Choose a monthly cycle'; end if;
    if profile_cycle='Salary date to next salary date' and (salary is null or salary not between 1 and 31) then raise exception 'Choose a salary day from 1 to 31'; end if;
    update public.profiles set full_name=public.lt_name(p->>'full_name',120),
      account_type=(p->>'account_type')::public.account_type_enum, currency='ZAR',monthly_cycle=profile_cycle,
      salary_day=case when profile_cycle='1st to month-end' then null else salary end where profiles.id=u
      returning to_jsonb(profiles.*) into result;
  when 'save_income' then
    amount:=public.lt_amount(p->>'amount'); d:=public.lt_date(p->>'received_date');
    if id is null then
      insert into public.income_sources(user_id,source_name,amount,frequency,received_date)
      values(u,public.lt_name(p->>'source_name',120),amount,(p->>'frequency')::public.income_frequency_enum,d)
      returning to_jsonb(income_sources.*) into result;
    else
      select date_trunc('month',received_date)::date into old_month from public.income_sources where income_id=id and user_id=u;
      update public.income_sources set source_name=public.lt_name(p->>'source_name',120),amount=mutation.amount,
        frequency=(p->>'frequency')::public.income_frequency_enum,received_date=d where income_id=id and user_id=u
        returning to_jsonb(income_sources.*) into result;
    end if;
    perform public.lt_ensure_budget(u,date_trunc('month',d)::date);
    if old_month is not null then perform public.lt_ensure_budget(u,old_month); end if;
  when 'delete_income' then
    delete from public.income_sources where income_id=id and user_id=u
      returning date_trunc('month',received_date)::date,to_jsonb(income_sources.*) into old_month,result;
    if old_month is not null then perform public.lt_ensure_budget(u,old_month); end if;
  when 'save_category' then
    m:=(p->>'month')::date;
    if m is null or m<date '1900-01-01' or m>public.lt_today()+interval '1 year' then raise exception 'Invalid budget month'; end if;
    b:=public.lt_ensure_budget(u,m); category:=(p->>'category_id')::integer;
    amount:=public.lt_amount(p->>'limit_amount',true);
    insert into public.budget_categories(budget_id,category_id,limit_amount)
    values(b,category,amount) on conflict(budget_id,category_id) do update set limit_amount=excluded.limit_amount
      returning to_jsonb(budget_categories.*) into result;
    perform public.recalc_budget_category_spent(b,category);
  when 'delete_category' then
    delete from public.budget_categories bc using public.budgets bu
      where bc.budget_category_id=id and bu.budget_id=bc.budget_id and bu.user_id=u returning to_jsonb(bc.*) into result;
  when 'save_expense' then
    amount:=public.lt_amount(p->>'amount'); d:=public.lt_date(p->>'expense_date');
    if length(coalesce(p->>'note',''))>2000 then raise exception 'Note must be at most 2000 characters'; end if;
    if id is null then
      insert into public.expenses(user_id,category_id,name,amount,expense_date,payment_method,note)
      values(u,(p->>'category_id')::integer,public.lt_name(p->>'name',150),amount,d,
        (p->>'payment_method')::public.payment_method_enum,nullif(p->>'note','')) returning to_jsonb(expenses.*) into result;
    else
      update public.expenses set category_id=(p->>'category_id')::integer,name=public.lt_name(p->>'name',150),
        amount=mutation.amount,expense_date=d,payment_method=(p->>'payment_method')::public.payment_method_enum,
        note=nullif(p->>'note','') where expense_id=id and user_id=u returning to_jsonb(expenses.*) into result;
    end if;
  when 'delete_expense' then
    delete from public.expenses where expense_id=id and user_id=u returning to_jsonb(expenses.*) into result;
  when 'save_goal' then
    amount:=public.lt_amount(p->>'target_amount');
    if id is null then
      insert into public.savings_goals(user_id,goal_name,target_amount)
        values(u,public.lt_name(p->>'goal_name',120),amount) returning to_jsonb(savings_goals.*) into result;
    else
      select * into goal from public.savings_goals where goal_id=id and user_id=u for update;
      if not found then raise exception 'Goal not found'; end if;
      update public.savings_goals set goal_name=public.lt_name(p->>'goal_name',120),target_amount=amount,
        status=case when goal.status='cancelled' then 'cancelled'::public.goal_status_enum
          when goal.saved_amount>=amount then 'completed'::public.goal_status_enum else 'active'::public.goal_status_enum end
        where goal_id=id returning to_jsonb(savings_goals.*) into result;
    end if;
  when 'cancel_goal' then
    update public.savings_goals set status='cancelled' where goal_id=id and user_id=u returning to_jsonb(savings_goals.*) into result;
  when 'contribute' then
    amount:=public.lt_amount(p->>'amount'); d:=public.lt_date(p->>'contribution_date');
    select * into goal from public.savings_goals where goal_id=(p->>'goal_id')::integer and user_id=u for update;
    if not found or goal.status<>'active' then raise exception 'Choose an active savings goal'; end if;
    insert into public.savings_contributions(goal_id,amount,contribution_date) values(goal.goal_id,amount,d)
      returning to_jsonb(savings_contributions.*) into result;
    update public.savings_goals set status='completed' where goal_id=goal.goal_id and saved_amount>=target_amount;
  when 'save_fund' then
    amount:=public.lt_amount(p->>'target_amount',true);
    insert into public.emergency_funds(user_id,target_amount) values(u,amount)
      on conflict(user_id) do update set target_amount=excluded.target_amount returning to_jsonb(emergency_funds.*) into result;
  when 'fund_transaction' then
    amount:=public.lt_amount(p->>'amount'); d:=public.lt_date(p->>'transaction_date');
    ctype:=(p->>'type')::public.fund_txn_type_enum;
    if ctype is null then raise exception 'Choose deposit or withdrawal'; end if;
    insert into public.emergency_funds(user_id) values(u) on conflict(user_id) do nothing;
    select * into strict fund from public.emergency_funds where user_id=u for update;
    if ctype='withdrawal' then
      if amount>fund.current_balance then raise exception 'Withdrawal exceeds available emergency money'; end if;
      reason_value:=(p->>'reason')::public.fund_txn_reason_enum;
      if reason_value is null then raise exception 'Choose a withdrawal reason'; end if;
    end if;
    insert into public.emergency_fund_transactions(fund_id,type,amount,reason,transaction_date)
      values(fund.fund_id,ctype,amount,reason_value,d) returning to_jsonb(emergency_fund_transactions.*) into result;
  when 'check_purchase' then
    amount:=public.lt_amount(p->>'amount'); category:=(p->>'category_id')::integer;
    summary:=public.lt_summary(); after_remaining:=(summary->>'remaining')::numeric-amount;
    before_daily:=(summary->>'safe_daily')::numeric;
    insert into public.tillcheck_history(user_id,item_name,amount,category_id,remaining_before,remaining_after,safe_daily_before,safe_daily_after)
      values(u,public.lt_name(p->>'item_name',150),amount,category,(summary->>'remaining')::numeric,after_remaining,
        before_daily,floor(greatest(after_remaining,0)*100/(summary->>'days')::integer)/100)
      returning * into checked;
    select bc.limit_amount,bc.spent_amount into limit_value,spent from public.budget_categories bc join public.budgets bu using(budget_id)
      where bu.user_id=u and bu.period_month=date_trunc('month',public.lt_today())::date and bc.category_id=category;
    result:=to_jsonb(checked)||jsonb_build_object('category_unbudgeted',limit_value is null,
      'category_exceeded',coalesce(spent+amount>limit_value,false));
  when 'purchase_check' then
    select * into checked from public.tillcheck_history where check_id=id and user_id=u for update;
    if not found then raise exception 'Purchase check not found'; end if;
    if checked.was_purchased then return to_jsonb(checked); end if;
    insert into public.expenses(user_id,category_id,name,amount,expense_date,payment_method,note)
      values(u,checked.category_id,checked.item_name,checked.amount,public.lt_today(),
        (p->>'payment_method')::public.payment_method_enum,'Recorded from TillCheck #'||checked.check_id);
    update public.tillcheck_history set was_purchased=true where check_id=id returning to_jsonb(tillcheck_history.*) into result;
  when 'clear_tillchecks' then
    with removed as (delete from public.tillcheck_history where user_id=u returning 1)
    select jsonb_build_object('cleared',count(*)) into result from removed;
  else raise exception 'Unknown operation';
  end case;
  if result is null then raise exception 'Record not found or not owned by this account' using errcode='42501'; end if;
  perform public.lt_alerts(u);
  return result;
end $$;

-- One public entry point per operation; callers cannot select arbitrary tables,
-- user IDs, computed totals, or fields. Definer owners must remain trusted admins.
do $$
declare a text;
begin
  foreach a in array array['save_profile','save_income','delete_income','save_category','delete_category',
    'save_expense','delete_expense','save_goal','cancel_goal','contribute','save_fund','fund_transaction',
    'check_purchase','purchase_check','clear_tillchecks'] loop
    execute format('create or replace function public.lt_%I(p_data jsonb) returns jsonb language sql security definer set search_path='''' as %L',
      a,format('select public.lt_write(%L,p_data)',a));
  end loop;
end $$;

-- Revoke table-level and preexisting column-level write grants. RLS policies stay
-- in place for ownership checks on reads. Financial DML is exclusively via RPC.
do $$
declare t text; r record;
begin
  foreach t in array array['profiles','income_sources','budgets','budget_categories','expenses',
    'savings_goals','savings_contributions','emergency_funds','emergency_fund_transactions',
    'tillcheck_history','user_settings','notifications','categories'] loop
    execute format('revoke insert,update,delete,truncate,references,trigger on public.%I from public,anon,authenticated',t);
    for r in select column_name from information_schema.columns where table_schema='public' and table_name=t loop
      execute format('revoke insert(%I),update(%I),references(%I) on public.%I from public,anon,authenticated',
        r.column_name,r.column_name,r.column_name,t);
    end loop;
    execute format('grant select on public.%I to authenticated',t);
    execute format('drop policy if exists lt_active_account on public.%I',t);
    execute format('create policy lt_active_account on public.%I as restrictive to authenticated using (public.lt_is_active()) with check (public.lt_is_active())',t);
  end loop;
end $$;
grant update(full_name,account_type) on public.profiles to authenticated;
grant update(notify_budget_alerts,notify_low_balance,notify_goal_progress) on public.user_settings to authenticated;
grant update(is_read) on public.notifications to authenticated;

-- Function execution is denied by default, including internal helpers.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'lt\_%' escape '\' loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  end loop;
end $$;
grant execute on function public.lt_is_active(),public.lt_summary(),public.lt_budget(date) to authenticated;
do $$
declare a text;
begin
  foreach a in array array['save_profile','save_income','delete_income','save_category','delete_category',
    'save_expense','delete_expense','save_goal','cancel_goal','contribute','save_fund','fund_transaction',
    'check_purchase','purchase_check','clear_tillchecks'] loop
    execute format('grant execute on function public.lt_%I(jsonb) to authenticated',a);
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
