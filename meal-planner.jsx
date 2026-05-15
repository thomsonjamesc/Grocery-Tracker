import { useState, useEffect, useCallback } from "react";

const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const CATEGORIES = ["Produce","Dairy","Meat & Seafood","Pantry","Frozen","Bakery","Other"];

const STORAGE_KEY = "mealplanner_v1";

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function save(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

const initialState = {
  recipes: [],
  weekPlan: {},
  pantry: [],
  prices: {},
  rotation: [],
};

function mergeIngredients(ingredients) {
  const map = {};
  for (const ing of ingredients) {
    const key = ing.name.toLowerCase().trim();
    if (map[key]) {
      map[key] = { ...map[key], qty: `${map[key].qty}, ${ing.qty}`.trim() };
    } else {
      map[key] = { ...ing, name: ing.name.trim() };
    }
  }
  return Object.values(map);
}

export default function App() {
  const [tab, setTab] = useState("planner");
  const [state, setState] = useState(() => load() || initialState);
  const [recipeUrl, setRecipeUrl] = useState("");
  const [recipeLoading, setRecipeLoading] = useState(false);
  const [recipeError, setRecipeError] = useState("");
  const [dragDay, setDragDay] = useState(null);
  const [priceModal, setPriceModal] = useState(null);
  const [priceInput, setPriceInput] = useState("");
  const [pantryInput, setPantryInput] = useState("");
  const [assignModal, setAssignModal] = useState(null);
  const [recipeDetail, setRecipeDetail] = useState(null);
  const [rotationWeek, setRotationWeek] = useState(0);
  const [toast, setToast] = useState("");

  useEffect(() => { save(state); }, [state]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  }

  const update = (patch) => setState(s => ({ ...s, ...patch }));

  async function fetchRecipe() {
    if (!recipeUrl.trim()) return;
    setRecipeLoading(true);
    setRecipeError("");
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: `You are a recipe parser. Given a recipe URL or any recipe text/title, extract the recipe details and return ONLY valid JSON (no markdown, no explanation) in this exact shape:
{
  "title": "Recipe Name",
  "servings": 4,
  "ingredients": [
    { "name": "ingredient name", "qty": "amount and unit", "category": "Produce|Dairy|Meat & Seafood|Pantry|Frozen|Bakery|Other" }
  ],
  "tags": ["quick","vegetarian","etc"]
}
If the URL is inaccessible, infer ingredients from the recipe name/URL path. Always return valid JSON only.`,
          messages: [{ role: "user", content: `Parse this recipe: ${recipeUrl}` }],
        }),
      });
      const data = await resp.json();
      const text = data.content?.map(b => b.text || "").join("") || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const recipe = JSON.parse(clean);
      recipe.id = Date.now().toString();
      recipe.url = recipeUrl;
      recipe.addedAt = new Date().toLocaleDateString();
      update({ recipes: [...state.recipes, recipe] });
      setRecipeUrl("");
      showToast(`"${recipe.title}" added to your library!`);
    } catch (e) {
      setRecipeError("Couldn't parse that recipe. Try pasting the recipe name or URL.");
    } finally {
      setRecipeLoading(false);
    }
  }

  function assignToDay(day, recipeId) {
    const plan = { ...state.weekPlan };
    if (!plan[day]) plan[day] = [];
    if (!plan[day].includes(recipeId)) plan[day] = [...plan[day], recipeId];
    update({ weekPlan: plan });
    setAssignModal(null);
    showToast("Recipe added to " + day);
  }

  function removeFromDay(day, recipeId) {
    const plan = { ...state.weekPlan };
    plan[day] = (plan[day] || []).filter(id => id !== recipeId);
    update({ weekPlan: plan });
  }

  function deleteRecipe(id) {
    const plan = {};
    for (const [d, ids] of Object.entries(state.weekPlan)) {
      plan[d] = ids.filter(i => i !== id);
    }
    update({
      recipes: state.recipes.filter(r => r.id !== id),
      weekPlan: plan,
      rotation: state.rotation.map(w => w.filter(i => i !== id)),
    });
    showToast("Recipe removed");
  }

  function buildShoppingList() {
    const allIngredients = [];
    for (const ids of Object.values(state.weekPlan)) {
      for (const id of ids) {
        const recipe = state.recipes.find(r => r.id === id);
        if (recipe) allIngredients.push(...recipe.ingredients);
      }
    }
    return mergeIngredients(allIngredients).map(ing => ({
      ...ing,
      inPantry: state.pantry.some(p => p.toLowerCase() === ing.name.toLowerCase()),
      price: state.prices[ing.name.toLowerCase()] || null,
    }));
  }

  const shoppingList = buildShoppingList();
  const totalCost = shoppingList
    .filter(i => !i.inPantry && i.price)
    .reduce((s, i) => s + parseFloat(i.price), 0);

  function saveToRotation() {
    const ids = Object.values(state.weekPlan).flat();
    if (!ids.length) return;
    update({ rotation: [...state.rotation, ids] });
    showToast("Week saved to rotation!");
  }

  function loadFromRotation(idx) {
    const ids = state.rotation[idx];
    const plan = {};
    ids.forEach((id, i) => {
      const day = DAYS[i % 7];
      if (!plan[day]) plan[day] = [];
      plan[day].push(id);
    });
    update({ weekPlan: plan });
    showToast("Rotation week loaded!");
  }

  function addPantryItem() {
    if (!pantryInput.trim()) return;
    const items = pantryInput.split(",").map(s => s.trim()).filter(Boolean);
    update({ pantry: [...new Set([...state.pantry, ...items])] });
    setPantryInput("");
  }

  const tabs = [
    { id: "planner", label: "Week Planner", icon: "ti-calendar" },
    { id: "library", label: "Recipe Library", icon: "ti-book" },
    { id: "shopping", label: "Shopping List", icon: "ti-shopping-cart" },
    { id: "pantry", label: "Pantry", icon: "ti-fridge" },
    { id: "rotation", label: "Rotation", icon: "ti-refresh" },
  ];

  return (
    <div style={{ fontFamily: "var(--font-sans)", padding: "1rem 0", minHeight: 600 }}>
      {toast && (
        <div style={{
          position: "fixed", top: 16, right: 16, zIndex: 999,
          background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-secondary)",
          borderRadius: "var(--border-radius-md)", padding: "10px 18px",
          fontSize: 14, color: "var(--color-text-primary)", boxShadow: "none",
          animation: "fadeIn 0.2s"
        }}>
          <i className="ti ti-check" style={{ color: "var(--color-text-success)", marginRight: 8 }} aria-hidden="true" />
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 500 }}>
          <i className="ti ti-salad" style={{ marginRight: 10, fontSize: 22 }} aria-hidden="true" />
          Meal Planner & Grocery Tracker
        </h2>
        <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--color-text-secondary)" }}>
          Plan your week, track prices, and build smart shopping lists
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: "1.5rem", borderBottom: "0.5px solid var(--color-border-tertiary)", paddingBottom: 0 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: "none", border: "none", borderBottom: tab === t.id ? "2px solid var(--color-text-primary)" : "2px solid transparent",
            padding: "8px 14px", fontSize: 13, fontWeight: tab === t.id ? 500 : 400,
            color: tab === t.id ? "var(--color-text-primary)" : "var(--color-text-secondary)",
            cursor: "pointer", display: "flex", alignItems: "center", gap: 6, marginBottom: -1,
          }}>
            <i className={`ti ${t.icon}`} style={{ fontSize: 15 }} aria-hidden="true" />
            {t.label}
          </button>
        ))}
      </div>

      {/* === PLANNER TAB === */}
      {tab === "planner" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <p style={{ margin: 0, fontSize: 14, color: "var(--color-text-secondary)" }}>
              Assign recipes to each day of the week
            </p>
            <button onClick={saveToRotation} style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              <i className="ti ti-device-floppy" style={{ fontSize: 14 }} aria-hidden="true" />
              Save week to rotation
            </button>
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {DAYS.map(day => {
              const dayRecipes = (state.weekPlan[day] || []).map(id => state.recipes.find(r => r.id === id)).filter(Boolean);
              return (
                <div key={day} style={{
                  background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)",
                  borderRadius: "var(--border-radius-md)", padding: "12px 16px",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: dayRecipes.length ? 10 : 0 }}>
                    <span style={{ fontWeight: 500, fontSize: 14 }}>{day}</span>
                    <button onClick={() => setAssignModal(day)} style={{ fontSize: 12, padding: "4px 10px" }}>
                      <i className="ti ti-plus" style={{ fontSize: 12, marginRight: 4 }} aria-hidden="true" />
                      Add recipe
                    </button>
                  </div>
                  {dayRecipes.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {dayRecipes.map(r => (
                        <div key={r.id} style={{
                          background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)",
                          padding: "6px 12px", fontSize: 13, display: "flex", alignItems: "center", gap: 8
                        }}>
                          <span
                            style={{ cursor: "pointer", color: "var(--color-text-primary)" }}
                            onClick={() => setRecipeDetail(r)}
                          >
                            {r.title}
                          </span>
                          {r.tags?.slice(0,2).map(tag => (
                            <span key={tag} style={{
                              fontSize: 11, padding: "2px 7px", borderRadius: 99,
                              background: "var(--color-background-info)", color: "var(--color-text-info)"
                            }}>{tag}</span>
                          ))}
                          <button onClick={() => removeFromDay(day, r.id)} style={{
                            background: "none", border: "none", padding: 0, cursor: "pointer",
                            color: "var(--color-text-tertiary)", fontSize: 14, lineHeight: 1
                          }} aria-label="Remove">
                            <i className="ti ti-x" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {dayRecipes.length === 0 && (
                    <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-tertiary)" }}>No meals planned</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* === LIBRARY TAB === */}
      {tab === "library" && (
        <div>
          {/* Add recipe */}
          <div style={{
            background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)",
            borderRadius: "var(--border-radius-lg)", padding: "1rem 1.25rem", marginBottom: "1.5rem"
          }}>
            <p style={{ margin: "0 0 10px", fontWeight: 500, fontSize: 14 }}>Add a recipe</p>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={recipeUrl}
                onChange={e => setRecipeUrl(e.target.value)}
                onKeyDown={e => e.key === "Enter" && fetchRecipe()}
                placeholder="Paste a recipe URL or type a recipe name…"
                style={{ flex: 1, fontSize: 14 }}
                disabled={recipeLoading}
              />
              <button onClick={fetchRecipe} disabled={recipeLoading} style={{ whiteSpace: "nowrap", fontSize: 14 }}>
                {recipeLoading ? <><i className="ti ti-loader" style={{ fontSize: 14, marginRight: 6 }} />Parsing…</> : <>
                  <i className="ti ti-sparkles" style={{ fontSize: 14, marginRight: 6 }} aria-hidden="true" />Parse with AI</>}
              </button>
            </div>
            {recipeError && <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--color-text-danger)" }}>{recipeError}</p>}
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--color-text-tertiary)" }}>
              Works with recipe URLs (AllRecipes, NYT Cooking, etc.) or just type a recipe name like "Chicken Tikka Masala"
            </p>
          </div>

          {state.recipes.length === 0 && (
            <div style={{ textAlign: "center", padding: "2rem", color: "var(--color-text-tertiary)", fontSize: 14 }}>
              <i className="ti ti-book" style={{ fontSize: 32, display: "block", marginBottom: 8 }} />
              No recipes yet. Add your first one above!
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
            {state.recipes.map(r => (
              <div key={r.id} style={{
                background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)",
                borderRadius: "var(--border-radius-lg)", padding: "1rem 1.25rem",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 500, fontSize: 15, cursor: "pointer" }} onClick={() => setRecipeDetail(r)}>{r.title}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--color-text-secondary)" }}>
                      {r.ingredients?.length} ingredients · {r.servings} servings
                    </p>
                  </div>
                  <button onClick={() => deleteRecipe(r.id)} style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: "var(--color-text-tertiary)", fontSize: 16, padding: 0
                  }} aria-label="Delete recipe">
                    <i className="ti ti-trash" />
                  </button>
                </div>
                {r.tags?.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
                    {r.tags.map(tag => (
                      <span key={tag} style={{
                        fontSize: 11, padding: "2px 8px", borderRadius: 99,
                        background: "var(--color-background-secondary)", color: "var(--color-text-secondary)"
                      }}>{tag}</span>
                    ))}
                  </div>
                )}
                {r.url && (
                  <a href={r.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--color-text-info)", textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}>
                    <i className="ti ti-external-link" style={{ fontSize: 12 }} aria-hidden="true" />
                    View source
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* === SHOPPING LIST TAB === */}
      {tab === "shopping" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <p style={{ margin: 0, fontSize: 14, color: "var(--color-text-secondary)" }}>
              {shoppingList.length} items needed · {shoppingList.filter(i => i.inPantry).length} already in pantry
            </p>
            {totalCost > 0 && (
              <span style={{ fontWeight: 500, fontSize: 15 }}>
                Est. total: ${totalCost.toFixed(2)}
              </span>
            )}
          </div>

          {shoppingList.length === 0 && (
            <div style={{ textAlign: "center", padding: "2rem", color: "var(--color-text-tertiary)", fontSize: 14 }}>
              <i className="ti ti-shopping-cart" style={{ fontSize: 32, display: "block", marginBottom: 8 }} />
              Plan your week first to generate a shopping list!
            </div>
          )}

          {CATEGORIES.map(cat => {
            const items = shoppingList.filter(i => i.category === cat);
            if (!items.length) return null;
            return (
              <div key={cat} style={{ marginBottom: "1.5rem" }}>
                <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 500, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{cat}</p>
                <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", overflow: "hidden" }}>
                  {items.map((item, idx) => (
                    <div key={item.name} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "10px 16px",
                      borderTop: idx > 0 ? "0.5px solid var(--color-border-tertiary)" : "none",
                      opacity: item.inPantry ? 0.5 : 1,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {item.inPantry && <i className="ti ti-check" style={{ fontSize: 14, color: "var(--color-text-success)" }} aria-hidden="true" />}
                        <div>
                          <span style={{ fontSize: 14, textDecoration: item.inPantry ? "line-through" : "none" }}>{item.name}</span>
                          <span style={{ fontSize: 12, color: "var(--color-text-secondary)", marginLeft: 8 }}>{item.qty}</span>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {item.price && (
                          <span style={{ fontSize: 13, fontWeight: 500 }}>${parseFloat(item.price).toFixed(2)}</span>
                        )}
                        <button
                          onClick={() => { setPriceModal(item.name); setPriceInput(item.price || ""); }}
                          style={{ fontSize: 12, padding: "3px 10px" }}
                        >
                          <i className="ti ti-tag" style={{ fontSize: 12, marginRight: 4 }} aria-hidden="true" />
                          {item.price ? "Edit price" : "Add price"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* === PANTRY TAB === */}
      {tab === "pantry" && (
        <div>
          <div style={{
            background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)",
            borderRadius: "var(--border-radius-lg)", padding: "1rem 1.25rem", marginBottom: "1.5rem"
          }}>
            <p style={{ margin: "0 0 10px", fontWeight: 500, fontSize: 14 }}>Add pantry items</p>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={pantryInput}
                onChange={e => setPantryInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addPantryItem()}
                placeholder="e.g. olive oil, garlic, salt, onions (comma-separated)"
                style={{ flex: 1, fontSize: 14 }}
              />
              <button onClick={addPantryItem} style={{ fontSize: 14 }}>
                <i className="ti ti-plus" style={{ fontSize: 14, marginRight: 6 }} aria-hidden="true" />
                Add
              </button>
            </div>
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--color-text-tertiary)" }}>
              Items in your pantry will be marked as "already have" on your shopping list
            </p>
          </div>

          {state.pantry.length === 0 && (
            <div style={{ textAlign: "center", padding: "2rem", color: "var(--color-text-tertiary)", fontSize: 14 }}>
              <i className="ti ti-fridge" style={{ fontSize: 32, display: "block", marginBottom: 8 }} />
              Your pantry is empty. Add items above!
            </div>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {state.pantry.map(item => (
              <div key={item} style={{
                background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)",
                borderRadius: 99, padding: "6px 14px", fontSize: 14, display: "flex", alignItems: "center", gap: 8
              }}>
                <i className="ti ti-check" style={{ fontSize: 12, color: "var(--color-text-success)" }} aria-hidden="true" />
                {item}
                <button onClick={() => update({ pantry: state.pantry.filter(p => p !== item) })} style={{
                  background: "none", border: "none", padding: 0, cursor: "pointer",
                  color: "var(--color-text-tertiary)", fontSize: 14, lineHeight: 1
                }} aria-label={`Remove ${item}`}>
                  <i className="ti ti-x" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* === ROTATION TAB === */}
      {tab === "rotation" && (
        <div>
          <p style={{ margin: "0 0 1rem", fontSize: 14, color: "var(--color-text-secondary)" }}>
            Save weekly meal plans and reload them in future weeks
          </p>
          {state.rotation.length === 0 && (
            <div style={{ textAlign: "center", padding: "2rem", color: "var(--color-text-tertiary)", fontSize: 14 }}>
              <i className="ti ti-refresh" style={{ fontSize: 32, display: "block", marginBottom: 8 }} />
              No saved rotations yet. Plan a week and click "Save week to rotation"!
            </div>
          )}
          <div style={{ display: "grid", gap: 12 }}>
            {state.rotation.map((ids, idx) => {
              const recipes = [...new Set(ids)].map(id => state.recipes.find(r => r.id === id)).filter(Boolean);
              return (
                <div key={idx} style={{
                  background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)",
                  borderRadius: "var(--border-radius-lg)", padding: "1rem 1.25rem",
                  display: "flex", justifyContent: "space-between", alignItems: "center"
                }}>
                  <div>
                    <p style={{ margin: "0 0 6px", fontWeight: 500, fontSize: 14 }}>Week {idx + 1}</p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {recipes.map(r => (
                        <span key={r.id} style={{
                          fontSize: 12, padding: "3px 10px", borderRadius: 99,
                          background: "var(--color-background-secondary)", color: "var(--color-text-secondary)"
                        }}>{r.title}</span>
                      ))}
                      {recipes.length === 0 && <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>Recipes may have been deleted</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexShrink: 0, marginLeft: 16 }}>
                    <button onClick={() => loadFromRotation(idx)} style={{ fontSize: 13 }}>
                      <i className="ti ti-calendar-plus" style={{ fontSize: 13, marginRight: 6 }} aria-hidden="true" />
                      Load this week
                    </button>
                    <button onClick={() => update({ rotation: state.rotation.filter((_, i) => i !== idx) })} style={{
                      fontSize: 13, background: "none", border: "0.5px solid var(--color-border-secondary)",
                      color: "var(--color-text-danger)"
                    }}>
                      <i className="ti ti-trash" style={{ fontSize: 13 }} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* === ASSIGN MODAL === */}
      {assignModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16
        }} onClick={() => setAssignModal(null)}>
          <div style={{
            background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)",
            border: "0.5px solid var(--color-border-secondary)", padding: "1.5rem", width: "100%", maxWidth: 400, maxHeight: 480, overflowY: "auto"
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <p style={{ margin: 0, fontWeight: 500 }}>Add to {assignModal}</p>
              <button onClick={() => setAssignModal(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)" }}>
                <i className="ti ti-x" />
              </button>
            </div>
            {state.recipes.length === 0 && <p style={{ color: "var(--color-text-tertiary)", fontSize: 14 }}>No recipes in library yet. Add some first!</p>}
            <div style={{ display: "grid", gap: 8 }}>
              {state.recipes.map(r => (
                <button key={r.id} onClick={() => assignToDay(assignModal, r.id)} style={{
                  textAlign: "left", padding: "10px 14px", borderRadius: "var(--border-radius-md)"
                }}>
                  <span style={{ display: "block", fontWeight: 500, fontSize: 14 }}>{r.title}</span>
                  <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{r.ingredients?.length} ingredients</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* === PRICE MODAL === */}
      {priceModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16
        }} onClick={() => setPriceModal(null)}>
          <div style={{
            background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)",
            border: "0.5px solid var(--color-border-secondary)", padding: "1.5rem", width: "100%", maxWidth: 340
          }} onClick={e => e.stopPropagation()}>
            <p style={{ margin: "0 0 12px", fontWeight: 500 }}>Set price for "{priceModal}"</p>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="number" step="0.01" min="0"
                value={priceInput}
                onChange={e => setPriceInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    const prices = { ...state.prices };
                    prices[priceModal.toLowerCase()] = priceInput;
                    update({ prices });
                    setPriceModal(null);
                  }
                }}
                placeholder="0.00"
                style={{ flex: 1, fontSize: 14 }}
                autoFocus
              />
              <button onClick={() => {
                const prices = { ...state.prices };
                prices[priceModal.toLowerCase()] = priceInput;
                update({ prices });
                setPriceModal(null);
                showToast("Price saved!");
              }} style={{ fontSize: 14 }}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* === RECIPE DETAIL MODAL === */}
      {recipeDetail && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16
        }} onClick={() => setRecipeDetail(null)}>
          <div style={{
            background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)",
            border: "0.5px solid var(--color-border-secondary)", padding: "1.5rem", width: "100%", maxWidth: 500, maxHeight: 520, overflowY: "auto"
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
              <div>
                <p style={{ margin: 0, fontWeight: 500, fontSize: 18 }}>{recipeDetail.title}</p>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--color-text-secondary)" }}>
                  {recipeDetail.servings} servings · {recipeDetail.ingredients?.length} ingredients
                </p>
              </div>
              <button onClick={() => setRecipeDetail(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--color-text-secondary)" }}>
                <i className="ti ti-x" />
              </button>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              {(recipeDetail.ingredients || []).map((ing, i) => (
                <div key={i} style={{
                  display: "flex", justifyContent: "space-between", padding: "7px 0",
                  borderBottom: "0.5px solid var(--color-border-tertiary)", fontSize: 14
                }}>
                  <span>{ing.name}</span>
                  <span style={{ color: "var(--color-text-secondary)" }}>{ing.qty}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
      `}</style>
    </div>
  );
}
