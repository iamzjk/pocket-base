-- Creation and edit prompts now accept up to 5,000 characters.
alter table public.revisions drop constraint revisions_prompt_check;
alter table public.revisions add constraint revisions_prompt_check check (length(prompt) <= 5000);
