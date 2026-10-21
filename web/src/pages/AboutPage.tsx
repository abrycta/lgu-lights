import { Page, StatCard, T, useLang } from "@abrycta/akari/react";
import { use } from "react";

import { loadManifest, loadMetrics } from "@/data/load";

const LINK = "underline underline-offset-4 hover:text-foreground";

function Validation() {
  const { lang } = useLang();
  const m = use(loadMetrics());
  const manifest = use(loadManifest());
  const h = m.headline;
  const fmt = (v: number | undefined, d = 1) => (v == null ? "—" : v.toFixed(d));
  const cov = h.model.coverage90 != null ? `${(h.model.coverage90 * 100).toFixed(0)}` : "—";
  return (
    <section className="grid gap-3" aria-labelledby="validation">
      <h2 id="validation" className="font-display text-xl">
        <T en="How good is the model?" ja="モデルの精度" />
      </h2>
      <p className="text-sm">
        <T
          en={`Fold ${h.fold}: trained on earlier rounds, tested on the ${h.test_round} PSA round it never saw, for ${h.n.toLocaleString("en")} LGUs. Mean absolute error in percentage points (lower is better):`}
          ja={`検証${h.fold}：それ以前の調査回で学習し、学習に使っていない${h.test_round}年のPSA調査回で${h.n.toLocaleString("ja")}市町村を検証。平均絶対誤差（ポイント、小さいほど良い）：`}
        />
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="validation">
        <StatCard label={lang === "ja" ? "モデル" : "Model"} value={fmt(h.model.mae, 2)} unit="pp" detail={lang === "ja" ? "夜間光＋植生" : "night lights + vegetation"} />
        <StatCard label={lang === "ja" ? "前回値の据え置き" : "Carry forward"} value={fmt(h.carry_forward_mae, 2)} unit="pp" detail={lang === "ja" ? "前回の公式値をそのまま使う" : "last official value, unchanged"} />
        <StatCard label={lang === "ja" ? "衛星データなし" : "No satellite data"} value={fmt(h.no_satellite_mae, 2)} unit="pp" detail={lang === "ja" ? "同じモデルから衛星特徴量を除外" : "same model, satellite features removed"} />
        <StatCard label={lang === "ja" ? "90%区間の的中率" : "90 % interval coverage"} value={cov} unit="%" detail={lang === "ja" ? "目標は90%" : "target 90 %"} />
      </div>
      {/synthetic|^v0/.test(manifest.version) ? (
        <p className="text-xs text-seal-text">
          <T
            en={`These numbers come from development data (${manifest.version}) with synthetic satellite inputs; they are not real results.`}
            ja={`これらの値は合成衛星データを使った開発用データ（${manifest.version}）のもので、実際の結果ではありません。`}
          />
        </p>
      ) : null}
    </section>
  );
}

export default function AboutPage() {
  return (
    <Page
      eyebrow={<T en="About & method" ja="概要と手法" />}
      title={<T en="Honest about the data" ja="データに正直に" />}
      lede={
        <T
          en="Lights maps poverty incidence for every Philippine city and municipality from 2012 to 2025, and always tells you which numbers are official and which are model estimates."
          ja="Lightsは2012〜2025年のフィリピン全市町村の貧困率を地図にし、どの値が公式統計でどの値がモデル推計かを常に示します。"
        />
      }
    >
      <div className="grid max-w-3xl gap-10 pb-12">
        <section className="grid gap-3 text-sm" aria-labelledby="honesty">
          <h2 id="honesty" className="font-display text-xl">
            <T en="Official figures and estimates" ja="公式統計と推計" />
          </h2>
          <p className="rounded-sm border border-seal p-3">
            <T
              en="Model estimates are not official statistics. They are predictions from satellite data, anchored on the last PSA round, with intervals that show how uncertain they are. Use PSA’s official figures for decisions whenever they exist."
              ja="モデル推計は公式統計ではありません。直近のPSA調査回を基準に衛星データから予測した値で、区間が不確かさを示します。判断には、公式値がある限りPSAの公式統計を使ってください。"
            />
          </p>
          <ul className="grid list-disc gap-1 pl-5">
            <li>
              <T
                en="PSA official figures (2012, 2015, 2018, 2021, 2023) are drawn solid, with their published 90 % confidence intervals. PSA changed method from ELL to Census EB between 2018 and 2021."
                ja="PSA公式値（2012・2015・2018・2021・2023年）は濃い色で、公表された90%信頼区間とともに表示します。PSAは2018年と2021年の間にELL法からCensus EB法へ手法を変更しました。"
              />
            </li>
            <li>
              <T
                en="Model estimates are drawn lighter and labelled “Model estimate (year)”, with 50 % and 90 % prediction intervals."
                ja="モデル推計は淡い色で「モデル推計（年）」と表示し、50%・90%の予測区間を添えます。"
              />
            </li>
            <li>
              <T
                en="Reliability tiers follow the coefficient of variation: reliable up to 10 %, use with caution up to 20 %, unreliable above (hatched on the map)."
                ja="信頼性は変動係数で区分：10%以下は信頼できる、20%以下は注意して使用、それを超えると信頼性が低い（地図では斜線）。"
              />
            </li>
            <li>
              <T
                en="Some PSA lower confidence limits are published below 0; poverty cannot be negative, so they are shown as 0."
                ja="PSAの下限値には0未満で公表されたものがあります。貧困率は負にならないため0と表示します。"
              />
            </li>
            <li>
              <T
                en="Backtests: in round years the panel also shows what the model would have said without that round, so you can judge it."
                ja="検証：調査年には、その調査回がなかった場合のモデル推計も表示し、精度を確かめられるようにしています。"
              />
            </li>
            <li>
              <T
                en="What-if scenarios are hypothetical, run in your browser, have a widened interval, and are never drawn on the main map."
                ja="仮定のシナリオはブラウザ内で計算する仮の値で、区間を広げて表示し、メインの地図には描きません。"
              />
            </li>
          </ul>
        </section>

        <Validation />

        <section className="grid gap-3 text-sm" aria-labelledby="sources">
          <h2 id="sources" className="font-display text-xl">
            <T en="Sources and licences" ja="出典とライセンス" />
          </h2>
          <ul className="grid list-disc gap-2 pl-5">
            <li>
              <T en="Poverty incidence: Philippine Statistics Authority (PSA), City and Municipal Level Small Area Poverty Estimates, 2012–2023. Used with attribution under PSA/OpenSTAT terms (CC BY; to be confirmed with PSA)." ja="貧困率：フィリピン統計庁（PSA）市町村別小地域貧困推計 2012〜2023年。PSA/OpenSTATの条件（CC BY、PSAに確認中）に従い出典を明記して使用。" />{" "}
              <a className={LINK} href="https://psa.gov.ph/">
                psa.gov.ph
              </a>
            </li>
            <li>
              <T en="Boundaries: OCHA/NAMRIA/PSA Common Operational Datasets (COD-AB), CC BY-IGO. Indicative, not official boundaries." ja="境界：OCHA/NAMRIA/PSA 共通運用データセット（COD-AB）、CC BY-IGO。参考であり公式の境界ではありません。" />{" "}
              <a className={LINK} href="https://data.humdata.org/dataset/cod-ab-phl">
                HDX
              </a>
            </li>
            <li>
              <T en="Night-time lights: NASA Black Marble VNP46A4 (annual), " ja="夜間光：NASA Black Marble VNP46A4（年次）、" />
              <a className={LINK} href="https://doi.org/10.5067/VIIRS/VNP46A4.002">
                doi:10.5067/VIIRS/VNP46A4.002
              </a>
            </li>
            <li>
              <T en="Vegetation: MODIS MOD13Q1 v061 (NDVI/EVI), via Google Earth Engine." ja="植生：MODIS MOD13Q1 v061（NDVI/EVI）、Google Earth Engine経由。" />
            </li>
            <li>
              <T en="Population: WorldPop, CC BY 4.0." ja="人口：WorldPop、CC BY 4.0。" />
            </li>
            <li>
              <T en="Elevation and slope: SRTM (NASA/USGS)." ja="標高・傾斜：SRTM（NASA/USGS）。" />
            </li>
          </ul>
          <p className="text-muted-foreground">
            <T
              en="Lights is an independent project, not affiliated with or endorsed by the PSA or any government agency."
              ja="Lightsは独立したプロジェクトで、PSAや政府機関とは関係がなく、承認も受けていません。"
            />
          </p>
        </section>
      </div>
    </Page>
  );
}
