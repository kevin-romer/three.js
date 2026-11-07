import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function replaceOnce(source, from, to) {
  if (source.split(from).length !== 2) throw Error('Patch anchor is not unique: ' + from.slice(0,80));
  return source.replace(from,to);
}
export function transform(source, file, variant) {
  if (variant === 'upstream') return source;
  if (variant === 'hidden-material' && file === 'src/renderers/WebGLRenderer.js') {
    // Keep recursion outside the gate: visible children of hidden-material parents still draw.
    const from = "const frustum = camera.isArrayCamera ? _frustumArray : _frustum;\n\n\t\t\t\t\tif ( ! object.frustumCulled || object.intersectsFrustum( frustum ) ) {";
    const to = "const frustum = camera.isArrayCamera ? _frustumArray : _frustum;\n\t\t\t\t\tconst material = object.material;\n\n\t\t\t\t\tif ( ( Array.isArray( material ) || material.visible ) && ( ! object.frustumCulled || object.intersectsFrustum( frustum ) ) ) {";
    if (source.split(from).length !== 3) throw Error('Expected Sprite and Mesh material guards');
    source = source.replaceAll(from,to);
    source = source.replaceAll("const geometry = objects.update( object );\n\t\t\t\t\t\tconst material = object.material;",
      "const geometry = objects.update( object );");
  }
  if (variant === 'sparse-batch' && file === 'src/objects/BatchedMesh.js') {
    source=replaceOnce(source,"matrix.toArray( matricesArray, instanceId * 16 );\n\t\tmatricesTexture.needsUpdate",
      "matrix.toArray( matricesArray, instanceId * 16 );\n\t\tmatricesTexture.addUpdateRange( instanceId * 16, 16 );\n\t\tmatricesTexture.needsUpdate");
    source=replaceOnce(source,"color.toArray( this._colorsTexture.image.data, instanceId * 4 );\n\t\tthis._colorsTexture.needsUpdate",
      "color.toArray( this._colorsTexture.image.data, instanceId * 4 );\n\t\tthis._colorsTexture.addUpdateRange( instanceId * 4, 4 );\n\t\tthis._colorsTexture.needsUpdate");
    // Creation/recycling writes must also participate in dirty-range tracking.
    source=replaceOnce(source,"_matrix.identity().toArray( matricesTexture.image.data, drawId * 16 );\n\t\tmatricesTexture.needsUpdate",
      "_matrix.identity().toArray( matricesTexture.image.data, drawId * 16 );\n\t\tmatricesTexture.addUpdateRange( drawId * 16, 16 );\n\t\tmatricesTexture.needsUpdate");
    source=replaceOnce(source,"_whiteColor.toArray( colorsTexture.image.data, drawId * 4 );\n\t\t\tcolorsTexture.needsUpdate",
      "_whiteColor.toArray( colorsTexture.image.data, drawId * 4 );\n\t\t\tcolorsTexture.addUpdateRange( drawId * 4, 4 );\n\t\t\tcolorsTexture.needsUpdate");

  }
  if ((variant === 'sparse-batch' || variant === 'resize-batch') && file === 'src/objects/BatchedMesh.js') {
    for (const name of ['indirect','matrices','colors']) {
      const from='copyArrayContents( '+name+'Texture.image.data, this._'+name+'Texture.image.data );';
      source=replaceOnce(source,from,from+'\n'+(name==='colors'?'\t\t\t':'\t\t')+'this._'+name+'Texture.needsUpdate = true;');
    }
  }
  if (variant === 'sparse-batch' && file === 'src/renderers/webgl/WebGLTextures.js') {
    source=replaceOnce(source,"function updateTexture( texture, image, glFormat, glType ) {",
      "function updateTexture( texture, image, glFormat, glType, allocateMemory ) {");
    source=replaceOnce(source,"if ( updateRanges.length === 0 ) {",
      "if ( updateRanges.length === 0 || allocateMemory ) {");
    source=replaceOnce(source,"state.texSubImage2D( _gl.TEXTURE_2D, 0, 0, 0, image.width, image.height, glFormat, glType, image.data );",
      "state.texSubImage2D( _gl.TEXTURE_2D, 0, 0, 0, image.width, image.height, glFormat, glType, image.data );\n\t\t\ttexture.clearUpdateRanges();");
    source=replaceOnce(source,"updateTexture( texture, image, glFormat, glType );",
      "updateTexture( texture, image, glFormat, glType, allocateMemory );");
  }
  if (variant === 'stable-indirect' && file === 'src/objects/BatchedMesh.js') {
    source=replaceOnce(source,"let multiDrawCount = 0;","let indirectChanged = false;\n\t\tlet multiDrawCount = 0;");
    source=replaceOnce(source,"indirectArray[ multiDrawCount ] = item.index;",
      "if ( indirectArray[ multiDrawCount ] !== item.index ) indirectChanged = true;\n\t\t\t\tindirectArray[ multiDrawCount ] = item.index;");
    source=replaceOnce(source,"indirectArray[ multiDrawCount ] = i;",
      "if ( indirectArray[ multiDrawCount ] !== i ) indirectChanged = true;\n\t\t\t\t\t\tindirectArray[ multiDrawCount ] = i;");
    source=replaceOnce(source,"indirectTexture.needsUpdate = true;\n\t\tthis._multiDrawCount",
      "if ( indirectChanged || indirectTexture.version === 0 ) indirectTexture.needsUpdate = true;\n\t\tthis._multiDrawCount");
  }
  if (variant === 'free-id-heap' && file === 'src/objects/BatchedMesh.js') {
    const helpers = `
function freeIdPush( heap, value ) {
  let index = heap.length;
  heap.push( value );
  while ( index > 0 ) {
    const parent = ( index - 1 ) >>> 1;
    if ( heap[ parent ] <= value ) break;
    heap[ index ] = heap[ parent ]; index = parent;
  }
  heap[ index ] = value;
}
function freeIdPop( heap ) {
  const result = heap[ 0 ], last = heap.pop();
  if ( heap.length > 0 ) {
    let index = 0;
    while ( index * 2 + 1 < heap.length ) {
      let child = index * 2 + 1;
      if ( child + 1 < heap.length && heap[ child + 1 ] < heap[ child ] ) child ++;
      if ( heap[ child ] >= last ) break;
      heap[ index ] = heap[ child ]; index = child;
    }
    heap[ index ] = last;
  }
  return result;
}
`;
    source=replaceOnce(source,"function ascIdSort( a, b ) {", helpers + "\nfunction ascIdSort( a, b ) {");
    for (const type of ['Instance','Geometry']) {
      source=replaceOnce(source,`this._available${type}Ids.sort( ascIdSort );\n\n\t\t\t${type==='Instance'?'drawId':'geometryId'} = this._available${type}Ids.shift();`,
        `${type==='Instance'?'drawId':'geometryId'} = freeIdPop( this._available${type}Ids );`);
      const id=type==='Instance'?'instanceId':'geometryId';
      source=replaceOnce(source,`this._available${type}Ids.push( ${id} );`,
        `freeIdPush( this._available${type}Ids, ${id} );`);
    }
  }
  return source;
}
export const variants = ['hidden-material','sparse-batch','stable-indirect','free-id-heap','resize-batch'];
export async function emitCandidates(repo, destination) {
  const files=['src/renderers/WebGLRenderer.js','src/objects/BatchedMesh.js','src/renderers/webgl/WebGLTextures.js'];
  for(const variant of variants)for(const file of files) {
    const original=await readFile(join(repo,file),'utf8'),candidate=transform(original,file,variant);
    if(candidate!==original){const target=join(destination,variant,file);await mkdir(join(target,'..'),{recursive:true});await writeFile(target,candidate);}
  }
}
