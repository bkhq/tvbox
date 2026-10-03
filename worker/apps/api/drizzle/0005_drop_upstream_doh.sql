-- DoH resolvers are no longer imported from upstreams (see sync.service.ts);
-- the ones imported before would otherwise linger. Common (local) entries stay.
DELETE FROM `tvbox_entries` WHERE `kind` = 'doh' AND `upstream_id` IS NOT NULL;
