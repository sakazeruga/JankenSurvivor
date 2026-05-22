import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const supabase = createClient(
  'https://nfrgavsowjipzobvywxu.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5mcmdhdnNvd2ppcHpvYnZ5d3h1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NDA4OTksImV4cCI6MjA5NTAxNjg5OX0.yeaSjnwWNzwWHS_rUg0jltTdKMIJmW6oMW2nUwEbma0'
);
