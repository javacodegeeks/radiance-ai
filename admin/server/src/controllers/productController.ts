/**
 * Product controller — HTTP layer only.
 * POST /products (create) requires 'admin' — resolved: admin role only can
 * add products, not pharmacists. GET /products?q= (search) is open to
 * either role, since a pharmacist reviewing a correction may still need to
 * look up a product's current catalog entry.
 */
import { Router, Response } from 'express';
import { addProduct, getProductEmbeddingStatus, reindexProduct, AddProductInput } from '../services/productService';
import { searchProducts, findProductById, AdminProductCategory } from '../repositories/productRepository';
import { requireRole, requireAnyStaffRole, AuthedRequest } from '../middleware/auth';
import { RepositoryError } from '../common/errors';

export const productRouter = Router();

const VALID_CATEGORIES: AdminProductCategory[] = ['cleanser', 'treatment', 'moisturizer', 'spf', 'exfoliant', 'none'];

productRouter.post('/products', requireRole('admin'), async (req: AuthedRequest, res: Response) => {
  const body = req.body as Partial<AddProductInput>;
  const { productName, brands, category } = body;

  if (!productName || !brands || !category || !VALID_CATEGORIES.includes(category)) {
    res.status(400).json({ error: `productName, brands and a valid category (${VALID_CATEGORIES.join(', ')}) are required` });
    return;
  }

  try {
    const result = await addProduct(
      {
        productName,
        brands,
        ingredientsText: body.ingredientsText ?? '',
        categoriesTags:  body.categoriesTags ?? [],
        countries:       body.countries ?? [],
        labelsTags:      body.labelsTags ?? [],
        allergensTags:   body.allergensTags ?? [],
        category,
      },
      req.tenantId!,
      req.clerkUserId!,
    );
    console.log(`[products] POST /products → 201 mongoId=${result.mongoId}`);
    res.status(201).json(result);
  } catch (error) {
    // Fails loudly, by design — an admin adding a product needs to know
    // immediately if the write didn't happen, unlike ai/'s recommender
    // "never block on failure" pattern for end-user-facing calls.
    console.error('[products] → ERROR', error);
    const status = error instanceof RepositoryError ? 503 : 500;
    res.status(status).json({ error: 'Failed to add product. Please try again.' });
  }
});

productRouter.get('/products', requireAnyStaffRole(), async (req: AuthedRequest, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
  const mine = req.query.mine === 'true';
  try {
    const { products, total } = await searchProducts(q, req.tenantId!, page, limit, mine);
    console.log(`[products] GET /products?q="${q}"&page=${page}&limit=${limit}&mine=${mine} → 200 (${products.length}/${total} result(s))`);
    res.json({ products, total, page, limit });
  } catch (error) {
    console.error('[products] → ERROR', error);
    const status = error instanceof RepositoryError ? 503 : 500;
    res.status(status).json({ error: 'Failed to search products. Please try again.' });
  }
});

productRouter.get('/products/:id/embedding', requireAnyStaffRole(), async (req: AuthedRequest, res: Response) => {
  const includeVector = req.query.vector === 'true';
  try {
    const product = await findProductById(req.params.id);
    if (!product) {
      console.warn(`[products] GET /products/${req.params.id}/embedding → 404 (product not found)`);
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    const status = await getProductEmbeddingStatus(req.params.id, includeVector);
    console.log(`[products] GET /products/${req.params.id}/embedding → 200 indexed=${status.indexed}`);
    res.json(status);
  } catch (error) {
    console.error('[products] → ERROR', error);
    const status = error instanceof RepositoryError ? 503 : 500;
    res.status(status).json({ error: 'Failed to fetch embedding status. Please try again.' });
  }
});

// Manual re-index — same 'admin' restriction as POST /products, since it
// writes to the shared Qdrant collection.
productRouter.post('/products/:id/reindex', requireRole('admin'), async (req: AuthedRequest, res: Response) => {
  try {
    const product = await findProductById(req.params.id);
    if (!product) {
      console.warn(`[products] POST /products/${req.params.id}/reindex → 404 (product not found)`);
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    const { qdrantId } = await reindexProduct(req.params.id, product);
    console.log(`[products] POST /products/${req.params.id}/reindex → 200 qdrantId=${qdrantId}`);
    res.json({ indexed: true, qdrantId });
  } catch (error) {
    console.error('[products] → ERROR', error);
    const status = error instanceof RepositoryError ? 503 : 500;
    res.status(status).json({ error: 'Failed to reindex product. Please try again.' });
  }
});
