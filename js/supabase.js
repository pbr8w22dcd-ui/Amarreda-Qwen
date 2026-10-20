// Configurazione Supabase per Amarreda

const SUPABASE_URL = 'INCOLLA_QUI_LA_TUA_PROJECT_URL';
const SUPABASE_ANON_KEY = 'INCOLLA_QUI_LA_TUA_CHIAVE_ANON_PUBLIC';

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
