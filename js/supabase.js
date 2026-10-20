// Configurazione Supabase per Amarreda

const SUPABASE_URL = 'https://utkxhkfhcrxfewxrzcvd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0a3hoa2ZoY3J4ZmV3eHJ6Y3ZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1MDU2MTMsImV4cCI6MjEwODA4MTYxM30.BBxC6hfCzwL_DUUaR0ZdX5CLbzbZlzv7TMeC_yQovJo';

// Inizializza il client Supabase
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Funzione helper per recuperare i modelli del catalogo
async function getCatalogModels(filters = {}) {
  let query = supabaseClient
    .from('catalog_models')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  
  if (filters.product_type) query = query.eq('product_type', filters.product_type);
  if (filters.style) query = query.eq('style', filters.style);
  if (filters.material) query = query.eq('material', filters.material);
  if (filters.brand) query = query.ilike('brand', `%${filters.brand}%`);
  if (filters.search) {
    query = query.or(`model_name.ilike.%${filters.search}%,brand.ilike.%${filters.search}%`);
  }
  
  const { data, error } = await query;
  
  if (error) {
    console.error('Errore nel recupero dei modelli:', error);
    return [];
  }
  
  return data;
}
