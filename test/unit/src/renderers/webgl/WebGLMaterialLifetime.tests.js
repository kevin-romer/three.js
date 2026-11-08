import { WebGLRenderer, Scene, OrthographicCamera, PlaneGeometry, Mesh, MeshBasicMaterial } from '../../../../../src/Three.js';

const listenerCount = material => material._listeners?.dispose?.length ?? 0;

function assets() {

	const geometry = new PlaneGeometry( 2, 2 );
	const material = new MeshBasicMaterial( { color: 0x00ff00 } );
	const scene = new Scene();
	scene.add( new Mesh( geometry, material ) );
	const camera = new OrthographicCamera( - 1, 1, 1, - 1, 0.1, 10 );
	camera.position.z = 2;
	return { geometry, material, scene, camera };

}

function renderer() {

	const r = new WebGLRenderer( { maxInactivePrograms: 4 } );
	r.setSize( 8, 8 );
	return r;

}

export default QUnit.module( 'Renderers', () => {

	QUnit.module( 'WebGLMaterialLifetime', () => {

		const canvas = document.createElement( 'canvas' );
		const context = canvas.getContext( 'webgl2' );
		const gpuTest = context ? QUnit.test : QUnit.skip;
		const restoreTest = context?.getExtension( 'WEBGL_lose_context' ) ? gpuTest : QUnit.skip;
		context?.getExtension( 'WEBGL_lose_context' )?.loseContext();

		gpuTest( 'retained assets do not accumulate renderer subscriptions', assert => {

			const a = assets(), unused = new MeshBasicMaterial();
			let externalDisposals = 0;
			const external = () => externalDisposals ++;
			a.material.addEventListener( 'dispose', external );
			try {

				for ( let i = 0; i < 3; i ++ ) {

					const r = renderer();
					try {

						r.render( a.scene, a.camera );
						assert.strictEqual( listenerCount( a.material ), 2 );
						r.dispose();
						assert.strictEqual( listenerCount( a.material ), 1, 'Only the application subscription survives' );
						assert.strictEqual( listenerCount( unused ), 0 );
						r.dispose();
						assert.strictEqual( listenerCount( a.material ), 1, 'Repeated disposal is harmless' );

					} finally {

						r.dispose();
						r.forceContextLoss();

					}

				}

				a.material.dispose();
				assert.strictEqual( externalDisposals, 1, 'Application callbacks still run' );

			} finally {

				a.material.removeEventListener( 'dispose', external );
				a.material.dispose();
				a.geometry.dispose();
				unused.dispose();

			}

		} );

		gpuTest( 'shared and array materials preserve another live renderer', assert => {

			const a = assets(), first = renderer(), second = renderer();
			a.geometry.clearGroups();
			a.geometry.addGroup( 0, 3, 0 );
			a.geometry.addGroup( 3, 3, 1 );
			a.scene.children[ 0 ].material = [ a.material, a.material ];
			try {

				first.render( a.scene, a.camera );
				second.render( a.scene, a.camera );
				assert.strictEqual( listenerCount( a.material ), 2 );
				first.dispose();
				assert.strictEqual( listenerCount( a.material ), 1 );
				second.render( a.scene, a.camera );
				const gl = second.getContext(), pixel = new Uint8Array( 4 );
				gl.readPixels( 4, 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel );
				assert.deepEqual( Array.from( pixel ), [ 0, 255, 0, 255 ] );
				a.material.dispose();
				assert.strictEqual( listenerCount( a.material ), 0 );
				second.render( a.scene, a.camera );
				assert.strictEqual( listenerCount( a.material ), 1, 'Reused material registers once' );
				second.dispose();
				assert.strictEqual( listenerCount( a.material ), 0 );
				a.material.dispose();
				assert.strictEqual( gl.getError(), gl.NO_ERROR );

			} finally {

				a.material.dispose();
				a.geometry.dispose();
				first.dispose();
				second.dispose();
				first.forceContextLoss();
				second.forceContextLoss();

			}

		} );

		restoreTest( 'context restoration unregisters the previous material lifetime', async assert => {

			assert.timeout( 15000 );
			const a = assets(), r = renderer(), canvas = r.domElement;
			try {

				r.render( a.scene, a.camera );
				assert.strictEqual( listenerCount( a.material ), 1 );
				const lost = new Promise( resolve => canvas.addEventListener( 'webglcontextlost', resolve, { once: true } ) );
				r.forceContextLoss();
				await lost;
				await new Promise( resolve => setTimeout( resolve, 1000 ) );
				const restored = new Promise( resolve => canvas.addEventListener( 'webglcontextrestored', resolve, { once: true } ) );
				r.forceContextRestore();
				await restored;
				assert.strictEqual( listenerCount( a.material ), 0 );
				r.render( a.scene, a.camera );
				assert.strictEqual( listenerCount( a.material ), 1 );
				r.dispose();
				assert.strictEqual( listenerCount( a.material ), 0 );

			} finally {

				a.material.dispose();
				a.geometry.dispose();
				r.dispose();
				r.forceContextLoss();

			}

		} );

	} );

} );
