/* global ol, map, fetch, Image, pako */
const MAX_ZOOM = 13

async function renderResults (feature) {
  const props = feature.getProperties()

  const name = props.description[0]
  const sciName = props.description[1]

  const res = await fetch(`https://api.inaturalist.org/v1/taxa?q=${sciName}`)
  const results = (await res.json()).results[0]
  const image = (results && results.default_photo)
    ? results.default_photo.square_url : './img/default_bird.png'

  const date = new Date(props.dateCreated).toDateString()
  const assetId = props.url.split('/')[props.url.split('/').length - 1]

  const imgTag = new Image()
  imgTag.onload = function () {
    let template = '<dt>'
    template += `     <img style="max-width: 75px; float: left; margin: 4px" src="${image}" alt="" />`
    template += `     <small style="font-size: 10px">${sciName}</small>`
    template += `     <h5 style="margin: 4px 0">${name}</h5>`
    template += `     <time style="font-size: 10px">${date}</time>`
    // Keeping this here in case the contentLocation is needed hidden in the semantics
    // template += `     <div style="font-size: 10px">${props.contentLocation}</div>`
    template += '   </dt>'
    template += '   <dd>'
    template += `     <audio controls><source src="${props.audio}"></audio>`
    template += '     <cite>'
    template += `       ${props.creator}`
    template += '       / Macaulay Library at the Cornell Lab'
    template += `       (<a href="${props.url}">ML${assetId}</a>)`
    template += '     </cite>'
    template += '   </dd>'

    document.querySelector('#results').innerHTML += template
  }
  imgTag.src = image
}

const { View, Map } = ol
const { Tile, Vector } = ol.layer
const { Stamen, Cluster } = ol.source
const { GeoJSON } = ol.format
const { Style, Circle, Stroke, Fill, Text } = ol.style
const { FullScreen } = ol.control

function renderMap () {
  const view = new View({
    center: [0, 0],
    zoom: 1,
    maxZoom: MAX_ZOOM
  })

  window.map = new Map({
    controls: ol.control.defaults().extend([new FullScreen()]),
    layers: [
      new Tile({ preload: Infinity, source: new Stamen({ layer: 'terrain' }) }),
      new Tile({ preload: Infinity, source: new Stamen({ layer: 'terrain-labels' }) })
      // new ol.layer.Tile({
      //   source: new ol.source.TileWMS({
      //     url: 'https://www.gebco.net/data_and_products/gebco_web_services/web_map_service/mapserv',
      //     params: {'LAYERS': 'GEBCO_LATEST', 'TILED': true},
      //     serverType: 'geoserver',
      //     // Countries have transparency, so do not fade tiles:
      //     transition: 0
      //   })
      // }),
    ],
    target: document.getElementById('map'),
    view: view
  })

  fetch('./data/macaulaylibrary.geojson.gz')
    .then((resp) => resp.arrayBuffer())
    .then((data) => {
      const inflated = pako.inflate(data)
      const decoded = new TextDecoder('utf-8').decode(inflated)
      const geojson = JSON.parse(decoded)

      const vectorSource = new ol.source.Vector({
        features: (new GeoJSON()).readFeatures(geojson, {
          featureProjection: 'EPSG:3857'
        })
      })

      const clusterSource = new Cluster({
        distance: 83,
        source: vectorSource
      })

      const vectorLayer = new Vector({
        source: clusterSource,
        style: function (cluster) {
          const features = cluster.get('features') || []
          const zoomLevel = map.getView().getZoom()
          const isMaxZoom = zoomLevel === MAX_ZOOM
          const geometry = features[0].getGeometry()
          const props = features[0].getProperties()

          const coords = ol.proj.toLonLat(geometry.getCoordinates())
          const text = props.contentLocation !== ''
            ? props.contentLocation : `${coords[1].toFixed(4)}, ${coords[0].toFixed(4)}`

          const locationText = isMaxZoom ? new Text({
            offsetX: 16,
            textAlign: 'left',
            font: '12px sans-serif',
            fontWeight: 'bold',
            text: text,
            fill: new Fill({ color: '#000' }),
            stroke: new Stroke({ width: 5, color: '#fff' })
          }) : null

          // If it is a single feature, then show the pinkish circle for now.
          // TODO: Migrate to images once we figure out the async style situation.
          const style = new Style({
            image: new Circle({
              radius: 17,
              stroke: new Stroke({ width: 2, color: '#fff' }),
              fill: new Fill({ color: '#77CCC7' })
            }),
            text: isMaxZoom ? locationText : new Text({
              offsetY: 1,
              textAlign: 'center',
              font: '10px sans-serif',
              text: `${features.length}`,
              fill: new Fill({ color: '#000' })
            })
          })

          return style
        }
      })

      map.addLayer(vectorLayer)
    })

  map.on('moveend', (event) => {
    const results = document.getElementById('results')
    var map = event.map
    if (map.getView().getZoom() < MAX_ZOOM) {
      results.style.opacity = 0
      results.innerHTML = ''
    }
  })

  map.addEventListener('click', function (e) {
    // Get all the features at the pixl of the mouse click.
    const features = this.getFeaturesAtPixel(e.pixel).filter(f => !(f.type === 'VECTOR'))
    if (features.length === 0) return

    // Start with an empty extent, and then loop through the features to grow
    // the extent so that it contains the extent of all the sub-features in
    // the cluster.
    const EmptyExtent = ol.extent.createEmpty
    const extent = new EmptyExtent()
    features[0].get('features').forEach(function (f, index, array) {
      ol.extent.extend(extent, f.getGeometry().getExtent())
    })

    // If the extent is minimal, meaning its top left is its bottom right, then
    // render the UI below. TODO: Slow and rude at anything > 30 results. Don't be rude.
    if (extent[0] === extent[2] || extent[1] === extent[3]) {
      // Render the cards below the map
      // Promise.all(features[0].get('features').map(renderResults));
      const goldenSmaller = window.innerWidth / 1.61803844258
      const bottomOffset = window.innerHeight - 40
      view.fit(extent, { duration: 500, padding: [40, goldenSmaller, bottomOffset, 0] })

      // FIXME: For now only grab the first 10 features of any given cluster.
      // FIXME: Either make all of these resolve OR switch to another Promise.all type
      //        mechanism that handles rejections and continues
      document.getElementById('results').innerHTML = ''

      if (features[0].get('features').length > 10) {
        document.getElementById('results').innerHTML =
          '<div style="font-size: 12px; text-align: center; padding: 4px; background: lightyellow">Note: only the first 10 results shown</div>'
      }
      Promise.all(features[0].get('features').slice(0, 10).map(renderResults)).then(() => {
        document.getElementById('results').style.opacity = 1
      })
    } else {
      // If there is an extent, "zoom" aka fit the view to the extent,
      // and re-render the map features at the new zoom level.
      const bottomOffset = window.innerHeight / 4
      view.fit(extent, { duration: 500, padding: [80, 60, bottomOffset, 60] })
    }
  })
}

renderMap()
