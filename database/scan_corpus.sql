-- Private photo corpus: only the server-side collector can access these tables.
create table public.scan_devices (
 id uuid primary key, key_hash text not null check(length(key_hash)=64),
 created_at timestamptz not null default now()
);
create table public.scan_reviewers (
 id uuid primary key, key_hash text not null check(length(key_hash)=64),
 created_at timestamptz not null default now()
);
create table public.scan_captures (
 id uuid primary key, device_id uuid not null references public.scan_devices(id),
 created_at timestamptz not null default now(), object_path text not null unique,
 content_sha256 text not null check(length(content_sha256)=64),
 byte_size integer not null check(byte_size between 1 and 52428800), mime text not null,
 metadata jsonb not null default '{}', observations jsonb not null default '{}',
 revision integer not null default 0, image_uploaded boolean not null default false,
 review_status text not null default 'pending' check(review_status in ('pending','verified','partial','unreadable'))
);
create index scan_captures_review_queue on public.scan_captures(review_status,created_at);
create index scan_captures_device on public.scan_captures(device_id,created_at);
create table public.scan_labels (
 id uuid primary key, capture_id uuid not null references public.scan_captures(id),
 reviewer_id uuid not null references public.scan_reviewers(id), created_at timestamptz not null default now(),
 image_sha256 text not null, observation_revision integer not null,
 status text not null check(status in ('verified','partial','unreadable')), labels jsonb not null,
 assessment jsonb not null default '{}'
);
create index scan_labels_capture on public.scan_labels(capture_id,created_at);
alter table public.scan_devices enable row level security;
alter table public.scan_reviewers enable row level security;
alter table public.scan_captures enable row level security;
alter table public.scan_labels enable row level security;
revoke all on public.scan_devices,public.scan_reviewers,public.scan_captures,public.scan_labels from public,anon,authenticated;
grant all on public.scan_devices,public.scan_reviewers,public.scan_captures,public.scan_labels to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('scan-corpus','scan-corpus',false,52428800,array['image/jpeg','image/png','image/webp','image/heic','image/heif','image/avif']);

