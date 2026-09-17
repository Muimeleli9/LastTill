-- Disposable test fixture matching the supplied schema/RLS/triggers.
-- NOT a deployment migration. Auth helpers below emulate Supabase JWT claims.
create role anon;
create role authenticated;
create schema auth;
create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select current_user::text $$;
grant usage on schema auth,public to anon,authenticated;
create type account_type_enum as enum ('Student','Employed','Entrepreneur');
create type income_frequency_enum as enum ('Once-off','Weekly','Monthly');
create type payment_method_enum as enum ('Bank Card','Cash','Transfer','Mobile Payment');
create type goal_status_enum as enum ('active','completed','cancelled');
create type fund_txn_type_enum as enum ('deposit','withdrawal');
create type fund_txn_reason_enum as enum ('Medication','Transport Emergency','Urgent Food','Family Emergency','Other');
create function set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
create table profiles(id uuid primary key references auth.users(id) on delete cascade,full_name varchar(120) not null,account_type account_type_enum not null,currency varchar(10) not null default 'ZAR',monthly_cycle varchar(60) not null default 'Salary date to next salary date',salary_day smallint,is_active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table categories(category_id integer generated always as identity primary key,name varchar(60) not null unique,is_default boolean not null default true,created_at timestamptz not null default now());
create table income_sources(income_id integer generated always as identity primary key,user_id uuid not null references profiles(id) on delete cascade,source_name varchar(120) not null,amount numeric(12,2) not null,frequency income_frequency_enum not null default 'Monthly',received_date date not null,created_at timestamptz not null default now());
create table budgets(budget_id integer generated always as identity primary key,user_id uuid not null references profiles(id) on delete cascade,period_month date not null,total_income numeric(12,2) not null default 0,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),constraint uq_budget_user_month unique(user_id,period_month));
create table budget_categories(budget_category_id integer generated always as identity primary key,budget_id integer not null references budgets(budget_id) on delete cascade,category_id integer not null references categories(category_id),limit_amount numeric(12,2) not null,spent_amount numeric(12,2) not null default 0,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),constraint uq_budget_category unique(budget_id,category_id));
create table expenses(expense_id integer generated always as identity primary key,user_id uuid not null references profiles(id) on delete cascade,category_id integer not null references categories(category_id),name varchar(150) not null,amount numeric(12,2) not null,expense_date date not null,payment_method payment_method_enum not null,note text,created_at timestamptz not null default now());
create table savings_goals(goal_id integer generated always as identity primary key,user_id uuid not null references profiles(id) on delete cascade,goal_name varchar(120) not null,target_amount numeric(12,2) not null,saved_amount numeric(12,2) not null default 0,status goal_status_enum not null default 'active',created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table savings_contributions(contribution_id integer generated always as identity primary key,goal_id integer not null references savings_goals(goal_id) on delete cascade,amount numeric(12,2) not null,contribution_date date not null default current_date,created_at timestamptz not null default now());
create table emergency_funds(fund_id integer generated always as identity primary key,user_id uuid not null unique references profiles(id) on delete cascade,target_amount numeric(12,2) not null default 0,current_balance numeric(12,2) not null default 0,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table emergency_fund_transactions(transaction_id integer generated always as identity primary key,fund_id integer not null references emergency_funds(fund_id) on delete cascade,type fund_txn_type_enum not null,amount numeric(12,2) not null,reason fund_txn_reason_enum,transaction_date date not null default current_date,created_at timestamptz not null default now());
create table tillcheck_history(check_id integer generated always as identity primary key,user_id uuid not null references profiles(id) on delete cascade,item_name varchar(150) not null,amount numeric(12,2) not null,category_id integer not null references categories(category_id),remaining_before numeric(12,2) not null,remaining_after numeric(12,2) not null,safe_daily_before numeric(12,2) not null,safe_daily_after numeric(12,2) not null,was_purchased boolean not null default false,created_at timestamptz not null default now());
create table user_settings(setting_id integer generated always as identity primary key,user_id uuid not null unique references profiles(id) on delete cascade,notify_budget_alerts boolean not null default true,notify_low_balance boolean not null default true,notify_goal_progress boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table notifications(notification_id integer generated always as identity primary key,user_id uuid not null references profiles(id) on delete cascade,title varchar(150) not null,message varchar(255) not null,is_read boolean not null default false,created_at timestamptz not null default now());
insert into categories(name) values('Groceries'),('Transport'),('Family Support'),('Social'),('Food & Dining'),('Data & Airtime'),('Personal'),('Clothing'),('Other');
create function handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$ begin insert into profiles(id,full_name,account_type) values(new.id,coalesce(new.raw_user_meta_data->>'full_name','New User'),coalesce((new.raw_user_meta_data->>'account_type')::account_type_enum,'Student')); insert into user_settings(user_id) values(new.id); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();
do $$ declare t text; begin
  foreach t in array array['profiles','budgets','budget_categories','savings_goals','emergency_funds','user_settings'] loop
    execute format('create trigger trg_%I before update on %I for each row execute function set_updated_at()',t||'_updated_at',t);
  end loop;
  foreach t in array array['profiles','categories','income_sources','budgets','budget_categories','expenses','savings_goals','savings_contributions','emergency_funds','emergency_fund_transactions','tillcheck_history','user_settings','notifications'] loop
    execute format('alter table %I enable row level security',t);
  end loop;
end $$;
grant all on all tables in schema public to anon,authenticated;
grant usage,select on all sequences in schema public to anon,authenticated;
create policy profiles_select_own on profiles for select using(auth.uid()=id);
create policy profiles_update_own on profiles for update using(auth.uid()=id);
create policy categories_select_all on categories for select using(auth.role()='authenticated');
do $$ declare t text; begin
  foreach t in array array['income_sources','budgets','expenses','savings_goals'] loop
    execute format('create policy select_own on %I for select using(auth.uid()=user_id)',t);
    execute format('create policy insert_own on %I for insert with check(auth.uid()=user_id)',t);
    execute format('create policy update_own on %I for update using(auth.uid()=user_id)',t);
    execute format('create policy delete_own on %I for delete using(auth.uid()=user_id)',t);
  end loop;
end $$;
create policy select_own on budget_categories for select using(exists(select 1 from budgets b where b.budget_id=budget_categories.budget_id and b.user_id=auth.uid()));
create policy insert_own on budget_categories for insert with check(exists(select 1 from budgets b where b.budget_id=budget_categories.budget_id and b.user_id=auth.uid()));
create policy update_own on budget_categories for update using(exists(select 1 from budgets b where b.budget_id=budget_categories.budget_id and b.user_id=auth.uid()));
create policy delete_own on budget_categories for delete using(exists(select 1 from budgets b where b.budget_id=budget_categories.budget_id and b.user_id=auth.uid()));
create policy select_own on savings_contributions for select using(exists(select 1 from savings_goals g where g.goal_id=savings_contributions.goal_id and g.user_id=auth.uid()));
create policy insert_own on savings_contributions for insert with check(exists(select 1 from savings_goals g where g.goal_id=savings_contributions.goal_id and g.user_id=auth.uid()));
create policy delete_own on savings_contributions for delete using(exists(select 1 from savings_goals g where g.goal_id=savings_contributions.goal_id and g.user_id=auth.uid()));
create policy select_own on emergency_funds for select using(auth.uid()=user_id);
create policy insert_own on emergency_funds for insert with check(auth.uid()=user_id);
create policy update_own on emergency_funds for update using(auth.uid()=user_id);
create policy select_own on emergency_fund_transactions for select using(exists(select 1 from emergency_funds f where f.fund_id=emergency_fund_transactions.fund_id and f.user_id=auth.uid()));
create policy insert_own on emergency_fund_transactions for insert with check(exists(select 1 from emergency_funds f where f.fund_id=emergency_fund_transactions.fund_id and f.user_id=auth.uid()));
create policy select_own on tillcheck_history for select using(auth.uid()=user_id);
create policy insert_own on tillcheck_history for insert with check(auth.uid()=user_id);
create policy select_own on user_settings for select using(auth.uid()=user_id);
create policy update_own on user_settings for update using(auth.uid()=user_id);
create policy select_own on notifications for select using(auth.uid()=user_id);
create policy update_own on notifications for update using(auth.uid()=user_id);
create policy delete_own on notifications for delete using(auth.uid()=user_id);

-- Original synchronization logic, intentionally not an alternate implementation.
create function recalc_budget_category_spent(p_budget_id integer,p_category_id integer) returns void language plpgsql as $$ begin
  update budget_categories bc set spent_amount=coalesce((select sum(e.amount) from expenses e join budgets b on b.budget_id=bc.budget_id where e.user_id=b.user_id and e.category_id=bc.category_id and date_trunc('month',e.expense_date)::date=b.period_month),0) where bc.budget_id=p_budget_id and bc.category_id=p_category_id;
end $$;
create function trg_expenses_sync_spent() returns trigger language plpgsql as $$ declare v_budget_id integer; begin
  if tg_op in ('INSERT','UPDATE') then
    select b.budget_id into v_budget_id from budgets b where b.user_id=new.user_id and b.period_month=date_trunc('month',new.expense_date)::date;
    if v_budget_id is not null then perform recalc_budget_category_spent(v_budget_id,new.category_id); end if;
  end if;
  if tg_op in ('UPDATE','DELETE') then
    select b.budget_id into v_budget_id from budgets b where b.user_id=old.user_id and b.period_month=date_trunc('month',old.expense_date)::date;
    if v_budget_id is not null then perform recalc_budget_category_spent(v_budget_id,old.category_id); end if;
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger trg_expenses_after_change after insert or update or delete on expenses for each row execute function trg_expenses_sync_spent();
create function trg_savings_contrib_sync() returns trigger language plpgsql as $$ declare v_goal_id integer:=coalesce(new.goal_id,old.goal_id); begin
  update savings_goals set saved_amount=coalesce((select sum(amount) from savings_contributions where goal_id=v_goal_id),0) where goal_id=v_goal_id;
  if tg_op='UPDATE' and old.goal_id is distinct from new.goal_id then update savings_goals set saved_amount=coalesce((select sum(amount) from savings_contributions where goal_id=old.goal_id),0) where goal_id=old.goal_id; end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger trg_savings_contrib_after_change after insert or update or delete on savings_contributions for each row execute function trg_savings_contrib_sync();
create function trg_emergency_txn_sync() returns trigger language plpgsql as $$ declare v_fund_id integer:=coalesce(new.fund_id,old.fund_id); begin
  update emergency_funds set current_balance=coalesce((select sum(case when type='deposit' then amount else -amount end) from emergency_fund_transactions where fund_id=v_fund_id),0) where fund_id=v_fund_id;
  if tg_op='UPDATE' and old.fund_id is distinct from new.fund_id then update emergency_funds set current_balance=coalesce((select sum(case when type='deposit' then amount else -amount end) from emergency_fund_transactions where fund_id=old.fund_id),0) where fund_id=old.fund_id; end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger trg_emergency_txn_after_change after insert or update or delete on emergency_fund_transactions for each row execute function trg_emergency_txn_sync();
