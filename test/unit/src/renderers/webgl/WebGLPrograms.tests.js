import { WebGLRenderer } from '../../../../../src/renderers/WebGLRenderer.js';
import { Scene } from '../../../../../src/scenes/Scene.js';
import { OrthographicCamera } from '../../../../../src/cameras/OrthographicCamera.js';
import { PlaneGeometry } from '../../../../../src/geometries/PlaneGeometry.js';
import { Mesh } from '../../../../../src/objects/Mesh.js';
import { ShaderMaterial } from '../../../../../src/materials/ShaderMaterial.js';
import { MeshBasicMaterial } from '../../../../../src/materials/MeshBasicMaterial.js';
import { Color } from '../../../../../src/math/Color.js';

function fixture( maxInactivePrograms ) {

	const renderer = new WebGLRenderer( { maxInactivePrograms } );
	renderer.setSize( 8, 8 );
	const gl = renderer.getContext();
	const counts = { created: 0, deleted: 0 };
	const createProgram = gl.createProgram.bind( gl );
	const deleteProgram = gl.deleteProgram.bind( gl );
	gl.createProgram = () => {

		counts.created ++; return createProgram();

	};

	gl.deleteProgram = program => {

		counts.deleted ++; deleteProgram( program );

	};

	const scene = new Scene();
	const camera = new OrthographicCamera( - 1, 1, 1, - 1, 0.1, 10 );
	camera.position.z = 2;
	const geometry = new PlaneGeometry( 2, 2 );
	const mesh = new Mesh( geometry );
	scene.add( mesh );

	return {
		renderer, counts, mesh,
		render( material ) {

			mesh.material = material;
			renderer.render( scene, camera );
			const pixel = new Uint8Array( 4 );
			gl.readPixels( 4, 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel );
			return { program: renderer.info.programs.find( program => program.usedTimes > 0 ), pixel: Array.from( pixel ) };

		},
		dispose() {

			mesh.material.dispose();
			geometry.dispose();
			renderer.dispose();
			renderer.forceContextLoss();

		}
	};

}

function shaderMaterial( color, variant = '' ) {

	return new ShaderMaterial( {
		vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
		fragmentShader: 'uniform vec3 uColor; void main() { gl_FragColor = vec4( uColor, 1.0 ); }\n' + variant,
		uniforms: { uColor: { value: new Color( color ) } }
	} );

}

export default QUnit.module( 'Renderers', () => {

	QUnit.module( 'WebGLPrograms', () => {

		QUnit.test( 'maxInactivePrograms validates its budget before creating a context', assert => {

			for ( const value of [ - 1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2' ] ) {

				assert.throws( () => new WebGLRenderer( { maxInactivePrograms: value } ), RangeError );

			}

		} );

		const canvas = document.createElement( 'canvas' );
		const context = canvas.getContext( 'webgl2' );
		const gpuTest = context ? QUnit.test : QUnit.skip;
		const canRestoreContext = Boolean( context?.getExtension( 'WEBGL_lose_context' ) );
		context?.getExtension( 'WEBGL_lose_context' )?.loseContext();

		gpuTest( 'zero budget preserves immediate release', assert => {

			const f = fixture( 0 );
			try {

				const material = shaderMaterial( 0xff0000 );
				assert.deepEqual( f.render( material ).pixel, [ 255, 0, 0, 255 ] );
				material.dispose();
				assert.strictEqual( f.renderer.info.programs.length, 0 );
				assert.strictEqual( f.counts.deleted, 1 );
				const next = shaderMaterial( 0x00ff00 );
				assert.deepEqual( f.render( next ).pixel, [ 0, 255, 0, 255 ] );
				assert.strictEqual( f.counts.created, 2 );

			} finally {

				f.dispose();

			}

		} );

		gpuTest( 'retained custom shaders keep cache identity and refresh uniforms', assert => {

			const f = fixture( 2 );
			try {

				const first = shaderMaterial( 0xff0000 );
				const initial = f.render( first );
				first.dispose();
				assert.strictEqual( initial.program.usedTimes, 0 );
				assert.strictEqual( f.counts.deleted, 0 );
				const second = shaderMaterial( 0x00ff00 );
				const reused = f.render( second );
				assert.strictEqual( reused.program, initial.program );
				assert.deepEqual( reused.pixel, [ 0, 255, 0, 255 ] );
				assert.strictEqual( f.counts.created, 1 );

			} finally {

				f.dispose();

			}

		} );

		gpuTest( 'reactivation refreshes LRU order without limiting active programs', assert => {

			const f = fixture( 2 );
			const cycle = tag => {

				const material = shaderMaterial( 0xff0000, '// ' + tag );
				const result = f.render( material );
				material.dispose();
				return result.program;

			};

			try {

				const a = cycle( 'A' );
				const b = cycle( 'B' );
				assert.strictEqual( cycle( 'A' ), a );
				cycle( 'C' );
				assert.strictEqual( b.program, undefined, 'B was least recently used' );
				assert.strictEqual( cycle( 'A' ), a, 'Reactivated A remains reusable' );
				assert.notStrictEqual( cycle( 'B' ), b, 'Evicted B must compile again' );
				const active = [];
				for ( let i = 0; i < 4; i ++ ) {

					const material = shaderMaterial( 0xff0000, '// active ' + i );
					active.push( material ); f.render( material );

				}

				assert.strictEqual( f.renderer.info.programs.filter( program => program.usedTimes > 0 ).length, 4 );
				for ( const material of active ) material.dispose();
				assert.strictEqual( f.renderer.info.programs.length, 2, 'Only inactive programs are bounded' );

			} finally {

				f.dispose();

			}

		} );

		gpuTest( 'built-in material uniforms refresh on reuse', assert => {

			const f = fixture( 1 );
			try {

				const first = new MeshBasicMaterial( { color: 0xff0000 } );
				const initial = f.render( first ); first.dispose();
				const second = new MeshBasicMaterial( { color: 0x00ff00 } );
				const reused = f.render( second );
				assert.strictEqual( reused.program, initial.program );
				assert.deepEqual( reused.pixel, [ 0, 255, 0, 255 ] );
				assert.strictEqual( f.counts.created, 1 );

			} finally {

				f.dispose();

			}

		} );

		gpuTest( 'onBeforeCompile retains the original cache-key stages', assert => {

			const f = fixture( 1 );
			const customize = parameters => {

				parameters.fragmentShader += '\n// customized';

			};

			try {

				const first = shaderMaterial( 0xff0000 ); first.onBeforeCompile = customize;
				const initial = f.render( first ); first.dispose();
				const second = shaderMaterial( 0x00ff00 ); second.onBeforeCompile = customize;
				assert.strictEqual( f.render( second ).program, initial.program );
				assert.strictEqual( f.counts.created, 1 );

			} finally {

				f.dispose();

			}

		} );

		gpuTest( 'failed links still report errors and are not retained', assert => {

			const f = fixture( 2 );
			try {

				let failures = 0;
				f.renderer.debug.onShaderError = () => {

					failures ++;

				};

				const material = shaderMaterial( 0xff0000 );
				material.fragmentShader = 'invalid shader source';
				f.render( material );
				assert.strictEqual( failures, 1, 'Link error callback remains enabled' );
				material.dispose();
				assert.strictEqual( f.renderer.info.programs.length, 0, 'Failed programs are released' );
				assert.strictEqual( f.counts.deleted, 1 );

			} finally {

				f.dispose();

			}

		} );

		const restoreTest = canRestoreContext ? QUnit.test : QUnit.skip;
		restoreTest( 'restored contexts start with a fresh bounded program cache', async assert => {

			assert.timeout( 15000 );
			const f = fixture( 1 );
			const canvas = f.renderer.domElement;
			try {

				const material = shaderMaterial( 0xff0000 );
				const initial = f.render( material ); material.dispose();
				const lost = new Promise( resolve => canvas.addEventListener( 'webglcontextlost', resolve, { once: true } ) );
				f.renderer.forceContextLoss(); await lost;
				// Let the browser finish dispatching loss before requesting restoration.
				await new Promise( resolve => setTimeout( resolve, 1000 ) );
				const restored = new Promise( resolve => canvas.addEventListener( 'webglcontextrestored', resolve, { once: true } ) );
				f.renderer.forceContextRestore(); await restored;
				assert.strictEqual( f.renderer.info.programs.length, 0 );
				const next = shaderMaterial( 0x00ff00 );
				const result = f.render( next );
				assert.notStrictEqual( result.program, initial.program );
				assert.deepEqual( result.pixel, [ 0, 255, 0, 255 ] );
				next.dispose();
				assert.strictEqual( f.renderer.info.programs.length, 1, 'The budget survives restoration' );

			} finally {

				f.dispose();

			}

		} );

		gpuTest( 'renderer disposal deletes active and inactive programs once', assert => {

			const f = fixture( 2 );
			try {

				const inactive = shaderMaterial( 0xff0000, '// inactive' );
				f.render( inactive ); inactive.dispose();
				const active = shaderMaterial( 0x00ff00, '// active' );
				f.render( active );
				assert.strictEqual( f.renderer.info.programs.length, 2 );
				f.renderer.dispose();
				assert.strictEqual( f.renderer.info.programs.length, 0 );
				assert.strictEqual( f.counts.deleted, f.counts.created );
				active.dispose(); f.renderer.dispose();
				assert.strictEqual( f.counts.deleted, f.counts.created, 'No duplicate deletion after disposal' );

			} finally {

				f.dispose();

			}

		} );

	} );

} );
