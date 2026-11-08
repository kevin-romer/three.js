import { WebGLBindingStates } from '../../../../../src/renderers/webgl/WebGLBindingStates.js';
import { WebGLRenderer, Scene, OrthographicCamera, PlaneGeometry, InstancedMesh, ShaderMaterial, Matrix4 } from '../../../../../src/Three.js';

function fixture() {

	const live = new Set();
	let created = 0, deleted = 0, bound;
	const gl = {
		getParameter: () => 16,
		createVertexArray() {

			const vao = { id: ++ created };
			live.add( vao );
			return vao;

		},
		bindVertexArray: vao => bound = vao,
		deleteVertexArray( vao ) {

			if ( ! live.delete( vao ) ) throw new Error( 'VAO deleted twice' );
			deleted ++;

		}
	};
	const states = WebGLBindingStates( gl, {} );
	return { states, live,
		get created() {

			return created;

		},
		get deleted() {

			return deleted;

		},
		setup( geometryId, program, objectId = 0, wireframe = false ) {

			states.setup( { id: objectId, isInstancedMesh: objectId !== 0 }, { wireframe }, program, { id: geometryId, attributes: {} }, null );
			return bound;

		}
	};

}

const program = id => ( { id, getAttributes: () => ( {} ) } );

export default QUnit.module( 'Renderers', () => {

	QUnit.module( 'WebGLBindingStates', () => {

		QUnit.test( 'program release preserves unrelated geometry and wireframe bindings', assert => {

			const f = fixture(), a = program( 1 ), b = program( 2 );
			f.setup( 1, a );
			f.setup( 1, a, 0, true );
			f.setup( 2, a );
			f.setup( 1, a, 10 );
			f.setup( 1, a, 11 );
			const kept = [ f.setup( 1, b ), f.setup( 3, b ) ];
			assert.strictEqual( f.created, 7 );
			f.states.releaseStatesOfProgram( a );
			assert.strictEqual( f.deleted, 5 );
			assert.true( kept.every( vao => f.live.has( vao ) ) );
			assert.strictEqual( f.setup( 1, b ), kept[ 0 ] );
			assert.strictEqual( f.setup( 3, b ), kept[ 1 ] );
			assert.strictEqual( f.created, 7, 'unrelated bindings are reused' );
			f.states.releaseStatesOfProgram( a );
			assert.strictEqual( f.deleted, 5, 'repeated release is harmless' );
			f.setup( 2, a );
			assert.strictEqual( f.created, 8, 'retired binding is rebuilt' );
			f.states.dispose();
			assert.strictEqual( f.deleted, 8 );
			assert.strictEqual( f.live.size, 0 );

		} );

		QUnit.test( 'geometry and object removal detach all program ownership', assert => {

			const f = fixture(), a = program( 1 ), b = program( 2 ), c = program( 3 );
			f.setup( 1, a );
			f.setup( 1, b );
			f.setup( 2, a, 10 );
			f.setup( 2, a, 11 );
			const kept = f.setup( 3, c );
			f.states.releaseStatesOfGeometry( { id: 1 } );
			assert.strictEqual( f.deleted, 2 );
			f.states.releaseStatesOfObject( { id: 10, isInstancedMesh: true } );
			assert.strictEqual( f.deleted, 3 );
			f.states.releaseStatesOfProgram( a );
			assert.strictEqual( f.deleted, 4 );
			f.states.releaseStatesOfProgram( b );
			assert.strictEqual( f.deleted, 4, 'removed geometry is not revisited' );
			assert.strictEqual( f.setup( 3, c ), kept );
			f.states.releaseStatesOfGeometry( { id: 1 } );
			f.states.releaseStatesOfObject( { id: 10, isInstancedMesh: true } );
			f.states.dispose();
			assert.strictEqual( f.deleted, 5 );
			f.states.dispose();
			f.setup( 4, a, 10, true );
			f.states.releaseStatesOfProgram( a );
			assert.strictEqual( f.deleted, 6, 'reuse after disposal has no stale ownership' );
			assert.strictEqual( f.live.size, 0 );

		} );

		QUnit.test( 'mixed lifecycle order releases each binding exactly once', assert => {

			const f = fixture(), programs = [ program( 1 ), program( 2 ), program( 3 ) ];
			for ( let round = 0; round < 12; round ++ ) {

				for ( let geometry = 1; geometry <= 8; geometry ++ ) {

					for ( const p of programs ) {

						f.setup( geometry, p, geometry % 2 ? 0 : 10 );
						f.setup( geometry, p, geometry % 2 ? 0 : 10, true );

					}

				}

				f.states.releaseStatesOfGeometry( { id: 1 } );
				f.states.releaseStatesOfProgram( programs[ round % 3 ] );
				f.states.releaseStatesOfObject( { id: 10, isInstancedMesh: true } );
				f.states.dispose();
				assert.strictEqual( f.live.size, 0 );
				assert.strictEqual( f.created, f.deleted );

			}

		} );

		const context = document.createElement( 'canvas' ).getContext( 'webgl2' );
		const gpuTest = context ? QUnit.test : QUnit.skip;
		context?.getExtension( 'WEBGL_lose_context' )?.loseContext();

		gpuTest( 'instanced survivors render after object, program and geometry retirement', assert => {

			const renderer = new WebGLRenderer( { maxInactivePrograms: 2 } );
			renderer.setSize( 8, 8 );
			const gl = renderer.getContext(), scene = new Scene(), geometry = new PlaneGeometry( 1, 2 );
			const camera = new OrthographicCamera( - 1, 1, 1, - 1, 0.1, 10 );
			camera.position.z = 2;
			const material = color => new ShaderMaterial( {
				vertexShader: 'void main(){ gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0); }',
				fragmentShader: `void main(){ gl_FragColor=vec4(${ color },1.0); }`
			} );
			const red = material( '1.0,0.0,0.0' ), green = material( '0.0,1.0,0.0' );
			const first = new InstancedMesh( geometry, red, 1 ), second = new InstancedMesh( geometry, green, 1 );
			first.setMatrixAt( 0, new Matrix4().makeTranslation( - 0.5, 0, 0 ) );
			second.setMatrixAt( 0, new Matrix4().makeTranslation( 0.5, 0, 0 ) );
			scene.add( first, second );
			const draw = () => {

				renderer.render( scene, camera );
				const pixel = new Uint8Array( 4 );
				gl.readPixels( 6, 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel );
				assert.deepEqual( Array.from( pixel ), [ 0, 255, 0, 255 ] );
				assert.strictEqual( gl.getError(), gl.NO_ERROR );

			};

			try {

				draw();
				scene.remove( first );
				first.dispose();
				red.dispose();
				draw();
				green.dispose();
				draw();
				geometry.dispose();
				draw();

			} finally {

				second.dispose();
				geometry.dispose();
				red.dispose();
				green.dispose();
				renderer.dispose();
				renderer.forceContextLoss();

			}

		} );

	} );

} );
